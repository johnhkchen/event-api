defmodule EventAPI.Workers.EventProcessingWorker do
  @moduledoc """
  Oban worker for processing scraped event data.
  
  This worker orchestrates the complete event processing pipeline:
  1. BAML content extraction from raw HTML
  2. Vector embedding generation
  3. Data quality scoring  
  4. Status tracking and PubSub notifications
  5. Error handling and retry logic
  """
  
  use Oban.Worker, queue: :processing, max_attempts: 3
  
  require Logger
  alias EventAPI.Events
  alias EventAPI.Events.Event
  alias EventAPI.Processing.ContentExtractor
  alias Phoenix.PubSub
  
  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"event_id" => event_id}} = job) do
    Logger.info("Starting event processing for event_id: #{event_id}")
    
    with {:ok, event} <- Events.get_event(event_id),
         :ok <- broadcast_processing_started(event_id),
         {:ok, extracted_data} <- extract_content(event),
         {:ok, updated_event} <- update_event_with_extraction(event, extracted_data),
         :ok <- broadcast_processing_completed(event_id, updated_event) do
      Logger.info("Successfully processed event_id: #{event_id}")
      :ok
    else
      {:error, :not_found} ->
        Logger.warning("Event not found for event_id: #{event_id}")
        {:cancel, "Event not found"}
        
      {:error, reason} = error ->
        Logger.error("Failed to process event_id: #{event_id}, reason: #{inspect(reason)}")
        broadcast_processing_error(event_id, reason)
        error
        
      error ->
        Logger.error("Unexpected error processing event_id: #{event_id}, error: #{inspect(error)}")
        broadcast_processing_error(event_id, "unexpected_error")
        {:error, "unexpected_error"}
    end
  rescue
    exception ->
      Logger.error("""
      Exception during event processing for event_id: #{event_id}
      Exception: #{Exception.format(:error, exception, __STACKTRACE__)}
      """)
      broadcast_processing_error(event_id, "exception")
      {:error, "exception"}
  end
  
  # Handle invalid job arguments
  @impl Oban.Worker
  def perform(%Oban.Job{args: args}) do
    Logger.error("Invalid job arguments for EventProcessingWorker: #{inspect(args)}")
    {:cancel, "Invalid arguments"}
  end
  
  @doc """
  Enqueues an event for processing.
  
  ## Examples
  
      iex> EventAPI.Workers.EventProcessingWorker.enqueue(123)
      {:ok, %Oban.Job{}}
      
      iex> EventAPI.Workers.EventProcessingWorker.enqueue(123, in: 60)
      {:ok, %Oban.Job{}}
  """
  def enqueue(event_id, opts \\ []) do
    %{event_id: event_id}
    |> new(opts)
    |> Oban.insert()
  end
  
  defp extract_content(%Event{raw_html: nil}) do
    {:error, "no_raw_html"}
  end
  
  defp extract_content(%Event{raw_html: raw_html} = event) do
    Logger.debug("Extracting content for event: #{event.name || "Unnamed Event"}")
    ContentExtractor.extract_content(raw_html)
  end
  
  defp update_event_with_extraction(event, extracted_data) do
    # Calculate data quality score based on extracted content completeness
    quality_score = calculate_quality_score(extracted_data)
    
    attrs = %{
      extracted_data: extracted_data,
      data_quality_score: quality_score,
      processed_at: DateTime.utc_now()
    }
    
    Events.update_event(event, attrs)
  end
  
  defp calculate_quality_score(extracted_data) do
    base_score = 20  # Base score for having extracted data
    
    # Add points for each piece of extracted information
    score = base_score
    |> add_score_if_present(extracted_data["title"], 15)
    |> add_score_if_present(extracted_data["description"], 20)
    |> add_score_if_present(extracted_data["speakers"], 15)
    |> add_score_if_present(extracted_data["topics"], 10)
    |> add_score_if_present(extracted_data["company"], 10)
    |> add_score_if_present(extracted_data["location"], 5)
    |> add_score_if_present(extracted_data["start_date"], 5)
    
    min(score, 100)  # Cap at 100
  end
  
  defp add_score_if_present(score, nil, _points), do: score
  defp add_score_if_present(score, "", _points), do: score
  defp add_score_if_present(score, [], _points), do: score
  defp add_score_if_present(score, %{} = map, _points) when map_size(map) == 0, do: score
  defp add_score_if_present(score, _value, points), do: score + points
  
  defp broadcast_processing_started(event_id) do
    PubSub.broadcast(
      EventAPI.PubSub,
      "event_processing:#{event_id}",
      {:processing_started, %{event_id: event_id, timestamp: DateTime.utc_now()}}
    )
    
    PubSub.broadcast(
      EventAPI.PubSub,
      "processing_queue:status",
      {:queue_update, %{event_id: event_id, status: :processing, timestamp: DateTime.utc_now()}}
    )
  end
  
  defp broadcast_processing_completed(event_id, event) do
    PubSub.broadcast(
      EventAPI.PubSub,
      "event_processing:#{event_id}",
      {:processing_completed, %{
        event_id: event_id, 
        quality_score: event.data_quality_score,
        timestamp: DateTime.utc_now()
      }}
    )
    
    PubSub.broadcast(
      EventAPI.PubSub,
      "processing_queue:status",
      {:queue_update, %{event_id: event_id, status: :completed, timestamp: DateTime.utc_now()}}
    )
  end
  
  defp broadcast_processing_error(event_id, reason) do
    PubSub.broadcast(
      EventAPI.PubSub,
      "event_processing:#{event_id}",
      {:processing_error, %{event_id: event_id, reason: reason, timestamp: DateTime.utc_now()}}
    )
    
    PubSub.broadcast(
      EventAPI.PubSub,
      "processing_queue:status",
      {:queue_update, %{event_id: event_id, status: :error, reason: reason, timestamp: DateTime.utc_now()}}
    )
  end
end