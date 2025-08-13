defmodule EventAPIWeb.ProcessingController do
  @moduledoc """
  Controller for internal event processing endpoints.
  
  These endpoints are designed for internal communication between services
  and provide access to the event processing pipeline orchestrator.
  """
  
  use EventAPIWeb, :controller
  require Logger
  
  alias EventAPI.Processing.PipelineOrchestrator
  alias EventAPI.Events
  
  action_fallback EventAPIWeb.FallbackController

  @doc """
  POST /internal/process
  
  Process a single event through the AI pipeline.
  """
  def process(conn, %{"event_id" => event_id} = params) do
    Logger.info("Processing request for event_id: #{event_id}")
    
    opts = []
    |> add_priority_option(params)
    |> add_delay_option(params)
    
    case PipelineOrchestrator.process_event(event_id, opts) do
      {:ok, job} ->
        conn
        |> put_status(:accepted)
        |> json(%{
          success: true,
          message: "Event queued for processing",
          job_id: job.id,
          event_id: event_id,
          estimated_completion: DateTime.add(DateTime.utc_now(), 300, :second)  # ~5 minutes
        })
        
      {:error, :service_unavailable} ->
        conn
        |> put_status(:service_unavailable)
        |> json(%{
          success: false,
          error: "Processing service temporarily unavailable",
          retry_after: 60
        })
        
      {:error, reason} ->
        Logger.error("Failed to process event_id: #{event_id}, reason: #{inspect(reason)}")
        
        conn
        |> put_status(:internal_server_error)
        |> json(%{
          success: false,
          error: "Failed to queue event for processing",
          details: inspect(reason)
        })
    end
  end

  @doc """
  POST /internal/process/batch
  
  Process multiple events in batch.
  """
  def process_batch(conn, %{"event_ids" => event_ids}) when is_list(event_ids) do
    Logger.info("Processing batch request for #{length(event_ids)} events")
    
    case PipelineOrchestrator.process_batch(event_ids) do
      {:ok, results} ->
        {successful, failed} = partition_results(results)
        
        conn
        |> put_status(:accepted)
        |> json(%{
          success: true,
          message: "Batch processing initiated",
          total_events: length(event_ids),
          queued_successfully: length(successful),
          failed_to_queue: length(failed),
          failed_events: failed,
          estimated_completion: DateTime.add(DateTime.utc_now(), 600, :second)  # ~10 minutes
        })
        
      {:error, :service_unavailable} ->
        conn
        |> put_status(:service_unavailable)
        |> json(%{
          success: false,
          error: "Processing service temporarily unavailable",
          retry_after: 120
        })
        
      {:error, reason} ->
        Logger.error("Failed to process batch, reason: #{inspect(reason)}")
        
        conn
        |> put_status(:internal_server_error)
        |> json(%{
          success: false,
          error: "Failed to queue batch for processing",
          details: inspect(reason)
        })
    end
  end

  @doc """
  GET /internal/processing/status
  
  Get current processing pipeline status and statistics.
  """
  def status(conn, _params) do
    case PipelineOrchestrator.get_status() do
      status when is_map(status) ->
        json(conn, %{
          success: true,
          status: status,
          timestamp: DateTime.utc_now()
        })
        
      {:error, reason} ->
        Logger.error("Failed to get processing status: #{inspect(reason)}")
        
        conn
        |> put_status(:internal_server_error)
        |> json(%{
          success: false,
          error: "Failed to retrieve processing status"
        })
    end
  end

  @doc """
  GET /internal/processing/health
  
  Health check for all processing services.
  """
  def health(conn, _params) do
    case PipelineOrchestrator.health_check() do
      health_status when is_map(health_status) ->
        overall_health = determine_overall_health(health_status)
        
        status_code = case overall_health do
          :healthy -> :ok
          :degraded -> :ok  # Still operational
          :unhealthy -> :service_unavailable
        end
        
        conn
        |> put_status(status_code)
        |> json(%{
          success: true,
          overall_health: overall_health,
          services: health_status,
          timestamp: DateTime.utc_now()
        })
        
      {:error, reason} ->
        Logger.error("Health check failed: #{inspect(reason)}")
        
        conn
        |> put_status(:service_unavailable)
        |> json(%{
          success: false,
          overall_health: :unhealthy,
          error: "Health check failed",
          details: inspect(reason),
          timestamp: DateTime.utc_now()
        })
    end
  end

  @doc """
  POST /internal/processing/circuit-breaker/reset
  
  Reset circuit breaker for a specific service.
  """
  def reset_circuit_breaker(conn, %{"service" => service}) do
    Logger.info("Resetting circuit breaker for service: #{service}")
    
    PipelineOrchestrator.reset_circuit_breaker(String.to_existing_atom(service))
    
    json(conn, %{
      success: true,
      message: "Circuit breaker reset for #{service}",
      timestamp: DateTime.utc_now()
    })
  rescue
    ArgumentError ->
      conn
      |> put_status(:bad_request)
      |> json(%{
        success: false,
        error: "Invalid service name",
        valid_services: ["baml_service"]
      })
  end

  # Handle invalid batch request
  def process_batch(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{
      success: false,
      error: "event_ids must be a list of event IDs"
    })
  end

  # Private helper functions

  defp add_priority_option(opts, %{"priority" => priority}) when is_integer(priority) do
    Keyword.put(opts, :priority, priority)
  end
  defp add_priority_option(opts, _), do: opts

  defp add_delay_option(opts, %{"delay" => delay}) when is_integer(delay) do
    Keyword.put(opts, :in, delay)
  end
  defp add_delay_option(opts, _), do: opts

  defp partition_results(results) do
    Enum.reduce(results, {[], []}, fn
      {:ok, _job}, {successful, failed} ->
        {[true | successful], failed}
      {:error, {event_id, reason}}, {successful, failed} ->
        {successful, [%{event_id: event_id, reason: reason} | failed]}
      {:error, reason}, {successful, failed} ->
        {successful, [%{event_id: nil, reason: reason} | failed]}
    end)
  end

  defp determine_overall_health(health_status) do
    service_states = Map.values(health_status)
    
    cond do
      Enum.all?(service_states, &(&1 == :healthy)) ->
        :healthy
      Enum.any?(service_states, &(&1 == :healthy)) ->
        :degraded
      true ->
        :unhealthy
    end
  end
end