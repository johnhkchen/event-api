defmodule EventAPI.Workers.EventProcessingWorkerTest do
  @moduledoc """
  Tests for the EventProcessingWorker Oban job.
  """
  
  use EventAPI.DataCase, async: true
  use Oban.Testing, repo: EventAPI.Repo
  
  alias EventAPI.Workers.EventProcessingWorker
  alias EventAPI.Events
  alias EventAPI.Events.Event
  
  describe "perform/1" do
    setup do
      # Create a test event with raw HTML
      {:ok, event} = Events.create_event(%{
        title: "Test Conference 2025",
        description: "A test event for processing",
        raw_html: "<html><body><h1>Test Conference</h1><p>Description</p></body></html>",
        luma_url: "https://lu.ma/test-event-123",
        date: ~U[2025-08-20 10:00:00Z],
        location: "San Francisco, CA"
      })
      
      %{event: event}
    end

    test "successfully processes an event with valid HTML", %{event: event} do
      # Mock successful BAML extraction
      expect(EventAPI.Services.BAMLClientMock, :extract_content, fn _html ->
        {:ok, %{
          "title" => "Extracted Conference Title",
          "description" => "Extracted description with details",
          "speakers" => [%{"name" => "John Doe", "role" => "Keynote"}],
          "topics" => ["AI", "Machine Learning"],
          "company" => "Tech Corp",
          "confidence" => 0.95
        }}
      end)

      job = %Oban.Job{args: %{"event_id" => event.id}}
      
      assert :ok = EventProcessingWorker.perform(job)
      
      # Verify event was updated
      updated_event = Events.get_event!(event.id)
      assert updated_event.extracted_data != nil
      assert updated_event.data_quality_score > 0
      assert updated_event.processed_at != nil
    end

    test "handles event with missing raw_html", %{event: event} do
      # Update event to remove raw_html
      {:ok, updated_event} = Events.update_event(event, %{raw_html: nil})
      
      job = %Oban.Job{args: %{"event_id" => updated_event.id}}
      
      assert {:error, "no_raw_html"} = EventProcessingWorker.perform(job)
    end

    test "handles non-existent event ID" do
      job = %Oban.Job{args: %{"event_id" => 99999}}
      
      assert {:cancel, "Event not found"} = EventProcessingWorker.perform(job)
    end

    test "handles BAML service errors", %{event: event} do
      # Mock BAML service failure
      expect(EventAPI.Services.BAMLClientMock, :extract_content, fn _html ->
        {:error, "service_error"}
      end)

      job = %Oban.Job{args: %{"event_id" => event.id}}
      
      assert {:error, "service_error"} = EventProcessingWorker.perform(job)
    end

    test "calculates correct quality scores based on extracted data", %{event: event} do
      # Test with minimal data
      expect(EventAPI.Services.BAMLClientMock, :extract_content, fn _html ->
        {:ok, %{"title" => "Basic Title"}}
      end)

      job = %Oban.Job{args: %{"event_id" => event.id}}
      EventProcessingWorker.perform(job)
      
      updated_event = Events.get_event!(event.id)
      assert updated_event.data_quality_score == 35  # 20 base + 15 title
      
      # Test with rich data
      expect(EventAPI.Services.BAMLClientMock, :extract_content, fn _html ->
        {:ok, %{
          "title" => "Rich Conference Title",
          "description" => "Detailed description",
          "speakers" => [%{"name" => "Jane Doe"}],
          "topics" => ["AI", "ML"],
          "company" => "TechCorp",
          "location" => "NYC",
          "start_date" => "2025-08-20"
        }}
      end)

      job2 = %Oban.Job{args: %{"event_id" => event.id}}
      EventProcessingWorker.perform(job2)
      
      final_event = Events.get_event!(event.id)
      assert final_event.data_quality_score == 100  # All fields present
    end

    test "handles invalid job arguments" do
      job = %Oban.Job{args: %{"invalid_key" => "invalid_value"}}
      
      assert {:cancel, "Invalid arguments"} = EventProcessingWorker.perform(job)
    end

    test "handles exceptions gracefully", %{event: event} do
      # Mock an exception in BAML service
      expect(EventAPI.Services.BAMLClientMock, :extract_content, fn _html ->
        raise RuntimeError, "Unexpected error"
      end)

      job = %Oban.Job{args: %{"event_id" => event.id}}
      
      assert {:error, "exception"} = EventProcessingWorker.perform(job)
    end
  end

  describe "enqueue/2" do
    test "enqueues a job successfully" do
      assert {:ok, %Oban.Job{}} = EventProcessingWorker.enqueue(123)
    end

    test "enqueues a job with options" do
      assert {:ok, %Oban.Job{}} = EventProcessingWorker.enqueue(123, priority: 1, in: 60)
    end
  end

  describe "PubSub notifications" do
    setup do
      Phoenix.PubSub.subscribe(EventAPI.PubSub, "event_processing:123")
      Phoenix.PubSub.subscribe(EventAPI.PubSub, "processing_queue:status")
      :ok
    end

    test "broadcasts processing lifecycle events", %{event: event} do
      expect(EventAPI.Services.BAMLClientMock, :extract_content, fn _html ->
        {:ok, %{"title" => "Test Event"}}
      end)

      job = %Oban.Job{args: %{"event_id" => event.id}}
      EventProcessingWorker.perform(job)
      
      # Should receive processing started message
      assert_receive {:processing_started, %{event_id: event_id}} when event_id == event.id
      
      # Should receive queue status update
      assert_receive {:queue_update, %{event_id: event_id, status: :processing}}
      
      # Should receive processing completed message
      assert_receive {:processing_completed, %{event_id: event_id, quality_score: score}} 
                     when event_id == event.id and is_integer(score)
      
      # Should receive final queue status
      assert_receive {:queue_update, %{event_id: event_id, status: :completed}}
    end

    test "broadcasts error events on processing failure", %{event: event} do
      expect(EventAPI.Services.BAMLClientMock, :extract_content, fn _html ->
        {:error, "test_error"}
      end)

      job = %Oban.Job{args: %{"event_id" => event.id}}
      EventProcessingWorker.perform(job)
      
      # Should receive error notification
      assert_receive {:processing_error, %{event_id: event_id, reason: "test_error"}}
      assert_receive {:queue_update, %{event_id: event_id, status: :error, reason: "test_error"}}
    end
  end
end