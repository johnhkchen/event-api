defmodule EventAPI.Processing.PipelineOrchestrator do
  @moduledoc """
  GenServer orchestrator for the complete event processing pipeline.
  
  This service coordinates the multi-step event processing workflow:
  1. Queue management and job scheduling
  2. Pipeline state tracking  
  3. Cross-service communication
  4. Error recovery and retry coordination
  5. Processing metrics collection
  6. Circuit breaker management for external services
  """
  
  use GenServer
  require Logger
  alias EventAPI.Workers.EventProcessingWorker
  alias EventAPI.Services.BAMLClient
  alias Phoenix.PubSub
  
  defstruct [:processing_stats, :circuit_breaker_state, :queue_stats]
  
  @circuit_breaker_threshold 5
  @circuit_breaker_timeout 30_000
  
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Logger.info("PipelineOrchestrator started")
    
    # Schedule periodic health checks
    schedule_health_check()
    schedule_stats_report()
    
    initial_state = %__MODULE__{
      processing_stats: %{
        total_processed: 0,
        successful: 0,
        failed: 0,
        average_processing_time: 0
      },
      circuit_breaker_state: %{
        baml_service: :closed,
        failure_count: 0,
        last_failure: nil,
        recovery_timeout: nil
      },
      queue_stats: %{
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0
      }
    }
    
    {:ok, initial_state}
  end

  # Public API

  @doc """
  Processes a single event through the complete pipeline.
  
  ## Examples
  
      iex> EventAPI.Processing.PipelineOrchestrator.process_event(123)
      {:ok, %Oban.Job{}}
      
      iex> EventAPI.Processing.PipelineOrchestrator.process_event(123, priority: 1)
      {:ok, %Oban.Job{}}
  """
  def process_event(event_id, opts \\ []) do
    GenServer.call(__MODULE__, {:process_event, event_id, opts})
  end

  @doc """
  Processes multiple events in batch.
  
  ## Examples
  
      iex> EventAPI.Processing.PipelineOrchestrator.process_batch([123, 124, 125])
      {:ok, [%Oban.Job{}, %Oban.Job{}, %Oban.Job{}]}
  """
  def process_batch(event_ids) when is_list(event_ids) do
    GenServer.call(__MODULE__, {:process_batch, event_ids})
  end

  @doc """
  Gets current processing statistics and queue status.
  """
  def get_status do
    GenServer.call(__MODULE__, :get_status)
  end

  @doc """
  Forces a health check of all external services.
  """
  def health_check do
    GenServer.call(__MODULE__, :health_check)
  end

  @doc """
  Resets the circuit breaker for a specific service.
  """
  def reset_circuit_breaker(service) do
    GenServer.cast(__MODULE__, {:reset_circuit_breaker, service})
  end

  # GenServer callbacks

  @impl true
  def handle_call({:process_event, event_id, opts}, _from, state) do
    Logger.info("Orchestrating processing for event_id: #{event_id}")
    
    case check_circuit_breaker(state, :baml_service) do
      :open ->
        Logger.warning("Circuit breaker open for BAML service, rejecting event_id: #{event_id}")
        {:reply, {:error, :service_unavailable}, state}
        
      _ ->
        case EventProcessingWorker.enqueue(event_id, opts) do
          {:ok, job} ->
            new_stats = update_queue_stats(state.queue_stats, :pending, 1)
            broadcast_queue_status(new_stats)
            {:reply, {:ok, job}, %{state | queue_stats: new_stats}}
            
          {:error, reason} = error ->
            Logger.error("Failed to enqueue event_id: #{event_id}, reason: #{inspect(reason)}")
            {:reply, error, state}
        end
    end
  end

  @impl true
  def handle_call({:process_batch, event_ids}, _from, state) do
    Logger.info("Orchestrating batch processing for #{length(event_ids)} events")
    
    case check_circuit_breaker(state, :baml_service) do
      :open ->
        Logger.warning("Circuit breaker open for BAML service, rejecting batch of #{length(event_ids)} events")
        {:reply, {:error, :service_unavailable}, state}
        
      _ ->
        results = Enum.map(event_ids, fn event_id ->
          case EventProcessingWorker.enqueue(event_id) do
            {:ok, job} -> {:ok, job}
            {:error, reason} -> {:error, {event_id, reason}}
          end
        end)
        
        successful = Enum.count(results, &match?({:ok, _}, &1))
        new_stats = update_queue_stats(state.queue_stats, :pending, successful)
        broadcast_queue_status(new_stats)
        
        {:reply, {:ok, results}, %{state | queue_stats: new_stats}}
    end
  end

  @impl true
  def handle_call(:get_status, _from, state) do
    status = %{
      processing_stats: state.processing_stats,
      queue_stats: state.queue_stats,
      circuit_breaker: state.circuit_breaker_state,
      timestamp: DateTime.utc_now()
    }
    
    {:reply, status, state}
  end

  @impl true
  def handle_call(:health_check, _from, state) do
    Logger.info("Performing health check on external services")
    
    baml_health = case BAMLClient.health_check() do
      {:ok, _} -> :healthy
      {:error, _} -> :unhealthy
    end
    
    new_circuit_state = update_circuit_breaker(state.circuit_breaker_state, :baml_service, baml_health)
    
    health_status = %{
      baml_service: baml_health,
      circuit_breaker: new_circuit_state,
      timestamp: DateTime.utc_now()
    }
    
    {:reply, health_status, %{state | circuit_breaker_state: new_circuit_state}}
  end

  @impl true
  def handle_cast({:reset_circuit_breaker, service}, state) do
    Logger.info("Resetting circuit breaker for service: #{service}")
    
    new_circuit_state = %{state.circuit_breaker_state | 
      "#{service}" => :closed,
      failure_count: 0,
      last_failure: nil,
      recovery_timeout: nil
    }
    
    {:noreply, %{state | circuit_breaker_state: new_circuit_state}}
  end

  @impl true
  def handle_info(:health_check, state) do
    # Perform periodic health checks
    case BAMLClient.health_check() do
      {:ok, _} ->
        new_circuit_state = update_circuit_breaker(state.circuit_breaker_state, :baml_service, :healthy)
        schedule_health_check()
        {:noreply, %{state | circuit_breaker_state: new_circuit_state}}
        
      {:error, _} ->
        new_circuit_state = update_circuit_breaker(state.circuit_breaker_state, :baml_service, :unhealthy)
        schedule_health_check()
        {:noreply, %{state | circuit_breaker_state: new_circuit_state}}
    end
  end

  @impl true
  def handle_info(:stats_report, state) do
    Logger.info("""
    Processing Pipeline Stats:
    #{inspect(state.processing_stats, pretty: true)}
    Queue Stats: 
    #{inspect(state.queue_stats, pretty: true)}
    Circuit Breaker:
    #{inspect(state.circuit_breaker_state, pretty: true)}
    """)
    
    # Broadcast stats for monitoring
    broadcast_stats(state)
    schedule_stats_report()
    
    {:noreply, state}
  end

  # Private helper functions

  defp check_circuit_breaker(state, service) do
    case state.circuit_breaker_state do
      %{^service => :open, recovery_timeout: timeout} when not is_nil(timeout) ->
        if DateTime.diff(DateTime.utc_now(), timeout, :millisecond) > 0 do
          :half_open
        else
          :open
        end
        
      %{^service => status} -> status
      _ -> :closed
    end
  end

  defp update_circuit_breaker(circuit_state, service, :healthy) do
    %{circuit_state | 
      "#{service}" => :closed,
      failure_count: 0,
      last_failure: nil,
      recovery_timeout: nil
    }
  end

  defp update_circuit_breaker(circuit_state, service, :unhealthy) do
    new_failure_count = circuit_state.failure_count + 1
    
    if new_failure_count >= @circuit_breaker_threshold do
      %{circuit_state |
        "#{service}" => :open,
        failure_count: new_failure_count,
        last_failure: DateTime.utc_now(),
        recovery_timeout: DateTime.add(DateTime.utc_now(), @circuit_breaker_timeout, :millisecond)
      }
    else
      %{circuit_state |
        failure_count: new_failure_count,
        last_failure: DateTime.utc_now()
      }
    end
  end

  defp update_queue_stats(stats, key, increment) do
    Map.update(stats, key, increment, &(&1 + increment))
  end

  defp broadcast_queue_status(queue_stats) do
    PubSub.broadcast(
      EventAPI.PubSub,
      "processing_queue:status",
      {:queue_stats, queue_stats}
    )
  end

  defp broadcast_stats(state) do
    PubSub.broadcast(
      EventAPI.PubSub,
      "processing_pipeline:stats",
      {:pipeline_stats, %{
        processing: state.processing_stats,
        queue: state.queue_stats,
        circuit_breaker: state.circuit_breaker_state,
        timestamp: DateTime.utc_now()
      }}
    )
  end

  defp schedule_health_check do
    Process.send_after(self(), :health_check, 30_000)  # Every 30 seconds
  end

  defp schedule_stats_report do
    Process.send_after(self(), :stats_report, 300_000)  # Every 5 minutes
  end
end