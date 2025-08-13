defmodule EventAPIWeb.ProcessingControllerTest do
  @moduledoc """
  Tests for the ProcessingController API endpoints.
  """
  
  use EventAPIWeb.ConnCase, async: true
  use Oban.Testing, repo: EventAPI.Repo
  
  alias EventAPI.Events
  
  describe "POST /internal/process" do
    setup do
      {:ok, event} = Events.create_event(%{
        title: "Test Conference",
        description: "A test event",
        raw_html: "<html><body>Test content</body></html>",
        luma_url: "https://lu.ma/test-event",
        date: ~U[2025-08-20 10:00:00Z],
        location: "Test City"
      })
      
      %{event: event}
    end

    test "successfully queues event for processing", %{conn: conn, event: event} do
      conn = post(conn, ~p"/internal/process", %{event_id: event.id})
      
      assert %{
        "success" => true,
        "message" => "Event queued for processing",
        "job_id" => job_id,
        "event_id" => event_id
      } = json_response(conn, 202)
      
      assert event_id == event.id
      assert is_binary(job_id)
      
      # Verify job was actually enqueued
      assert_enqueued(worker: EventAPI.Workers.EventProcessingWorker, args: %{"event_id" => event.id})
    end

    test "queues event with priority option", %{conn: conn, event: event} do
      conn = post(conn, ~p"/internal/process", %{event_id: event.id, priority: 1})
      
      assert %{"success" => true} = json_response(conn, 202)
      
      assert_enqueued(
        worker: EventAPI.Workers.EventProcessingWorker, 
        args: %{"event_id" => event.id},
        priority: 1
      )
    end

    test "queues event with delay option", %{conn: conn, event: event} do
      conn = post(conn, ~p"/internal/process", %{event_id: event.id, delay: 60})
      
      assert %{"success" => true} = json_response(conn, 202)
      
      assert_enqueued(
        worker: EventAPI.Workers.EventProcessingWorker,
        args: %{"event_id" => event.id},
        scheduled_at: {DateTime.utc_now(), DateTime.add(DateTime.utc_now(), 60, :second)}
      )
    end

    test "handles missing event_id parameter", %{conn: conn} do
      conn = post(conn, ~p"/internal/process", %{})
      
      assert %{"success" => false, "error" => error} = json_response(conn, 500)
      assert is_binary(error)
    end

    test "returns service unavailable when circuit breaker is open", %{conn: conn, event: event} do
      # Mock circuit breaker open state
      expect(EventAPI.Processing.PipelineOrchestrator, :process_event, fn _event_id, _opts ->
        {:error, :service_unavailable}
      end)
      
      conn = post(conn, ~p"/internal/process", %{event_id: event.id})
      
      assert %{
        "success" => false,
        "error" => "Processing service temporarily unavailable",
        "retry_after" => 60
      } = json_response(conn, 503)
    end
  end

  describe "POST /internal/process/batch" do
    setup do
      events = for i <- 1..3 do
        {:ok, event} = Events.create_event(%{
          title: "Test Conference #{i}",
          description: "Test event #{i}",
          raw_html: "<html><body>Test content #{i}</body></html>",
          luma_url: "https://lu.ma/test-event-#{i}",
          date: ~U[2025-08-20 10:00:00Z],
          location: "Test City"
        })
        event
      end
      
      %{events: events}
    end

    test "successfully processes batch of events", %{conn: conn, events: events} do
      event_ids = Enum.map(events, & &1.id)
      
      conn = post(conn, ~p"/internal/process/batch", %{event_ids: event_ids})
      
      assert %{
        "success" => true,
        "message" => "Batch processing initiated",
        "total_events" => 3,
        "queued_successfully" => 3,
        "failed_to_queue" => 0,
        "failed_events" => []
      } = json_response(conn, 202)
      
      # Verify all jobs were enqueued
      for event_id <- event_ids do
        assert_enqueued(worker: EventAPI.Workers.EventProcessingWorker, args: %{"event_id" => event_id})
      end
    end

    test "handles partial batch failures", %{conn: conn, events: events} do
      event_ids = [Enum.at(events, 0).id, 99999, Enum.at(events, 1).id]  # Include invalid ID
      
      # Mock partial failure
      expect(EventAPI.Processing.PipelineOrchestrator, :process_batch, fn _event_ids ->
        {:ok, [
          {:ok, %Oban.Job{id: 1}},
          {:error, {99999, "not_found"}},
          {:ok, %Oban.Job{id: 2}}
        ]}
      end)
      
      conn = post(conn, ~p"/internal/process/batch", %{event_ids: event_ids})
      
      assert %{
        "success" => true,
        "total_events" => 3,
        "queued_successfully" => 2,
        "failed_to_queue" => 1,
        "failed_events" => [%{"event_id" => 99999, "reason" => "not_found"}]
      } = json_response(conn, 202)
    end

    test "handles invalid event_ids parameter", %{conn: conn} do
      conn = post(conn, ~p"/internal/process/batch", %{event_ids: "not a list"})
      
      assert %{
        "success" => false,
        "error" => "event_ids must be a list of event IDs"
      } = json_response(conn, 400)
    end

    test "handles missing event_ids parameter", %{conn: conn} do
      conn = post(conn, ~p"/internal/process/batch", %{})
      
      assert %{
        "success" => false,
        "error" => "event_ids must be a list of event IDs"
      } = json_response(conn, 400)
    end

    test "returns service unavailable when circuit breaker is open", %{conn: conn, events: events} do
      event_ids = Enum.map(events, & &1.id)
      
      expect(EventAPI.Processing.PipelineOrchestrator, :process_batch, fn _event_ids ->
        {:error, :service_unavailable}
      end)
      
      conn = post(conn, ~p"/internal/process/batch", %{event_ids: event_ids})
      
      assert %{
        "success" => false,
        "error" => "Processing service temporarily unavailable",
        "retry_after" => 120
      } = json_response(conn, 503)
    end
  end

  describe "GET /internal/processing/status" do
    test "returns current processing status", %{conn: conn} do
      # Mock status response
      expect(EventAPI.Processing.PipelineOrchestrator, :get_status, fn ->
        %{
          processing_stats: %{
            total_processed: 150,
            successful: 140,
            failed: 10,
            average_processing_time: 2500
          },
          queue_stats: %{
            pending: 5,
            processing: 2,
            completed: 140,
            failed: 10
          },
          circuit_breaker: %{
            baml_service: :closed,
            failure_count: 0
          },
          timestamp: DateTime.utc_now()
        }
      end)
      
      conn = get(conn, ~p"/internal/processing/status")
      
      assert %{
        "success" => true,
        "status" => %{
          "processing_stats" => %{
            "total_processed" => 150,
            "successful" => 140,
            "failed" => 10
          },
          "queue_stats" => %{
            "pending" => 5,
            "processing" => 2,
            "completed" => 140,
            "failed" => 10
          }
        }
      } = json_response(conn, 200)
    end

    test "handles status retrieval errors", %{conn: conn} do
      expect(EventAPI.Processing.PipelineOrchestrator, :get_status, fn ->
        {:error, "orchestrator_unavailable"}
      end)
      
      conn = get(conn, ~p"/internal/processing/status")
      
      assert %{
        "success" => false,
        "error" => "Failed to retrieve processing status"
      } = json_response(conn, 500)
    end
  end

  describe "GET /internal/processing/health" do
    test "returns healthy status when all services are operational", %{conn: conn} do
      expect(EventAPI.Processing.PipelineOrchestrator, :health_check, fn ->
        %{
          baml_service: :healthy,
          circuit_breaker: %{baml_service: :closed},
          timestamp: DateTime.utc_now()
        }
      end)
      
      conn = get(conn, ~p"/internal/processing/health")
      
      assert %{
        "success" => true,
        "overall_health" => "healthy",
        "services" => %{
          "baml_service" => "healthy"
        }
      } = json_response(conn, 200)
    end

    test "returns degraded status when some services are unhealthy", %{conn: conn} do
      expect(EventAPI.Processing.PipelineOrchestrator, :health_check, fn ->
        %{
          baml_service: :unhealthy,
          other_service: :healthy,
          circuit_breaker: %{baml_service: :open},
          timestamp: DateTime.utc_now()
        }
      end)
      
      conn = get(conn, ~p"/internal/processing/health")
      
      assert %{
        "success" => true,
        "overall_health" => "degraded"
      } = json_response(conn, 200)
    end

    test "returns unhealthy status when all services are down", %{conn: conn} do
      expect(EventAPI.Processing.PipelineOrchestrator, :health_check, fn ->
        %{
          baml_service: :unhealthy,
          circuit_breaker: %{baml_service: :open},
          timestamp: DateTime.utc_now()
        }
      end)
      
      conn = get(conn, ~p"/internal/processing/health")
      
      assert %{
        "success" => true,
        "overall_health" => "unhealthy"
      } = json_response(conn, 503)
    end

    test "handles health check failures", %{conn: conn} do
      expect(EventAPI.Processing.PipelineOrchestrator, :health_check, fn ->
        {:error, "health_check_failed"}
      end)
      
      conn = get(conn, ~p"/internal/processing/health")
      
      assert %{
        "success" => false,
        "overall_health" => "unhealthy",
        "error" => "Health check failed"
      } = json_response(conn, 503)
    end
  end

  describe "POST /internal/processing/circuit-breaker/reset" do
    test "successfully resets circuit breaker for valid service", %{conn: conn} do
      expect(EventAPI.Processing.PipelineOrchestrator, :reset_circuit_breaker, fn :baml_service ->
        :ok
      end)
      
      conn = post(conn, ~p"/internal/processing/circuit-breaker/reset", %{service: "baml_service"})
      
      assert %{
        "success" => true,
        "message" => "Circuit breaker reset for baml_service"
      } = json_response(conn, 200)
    end

    test "handles invalid service names", %{conn: conn} do
      conn = post(conn, ~p"/internal/processing/circuit-breaker/reset", %{service: "invalid_service"})
      
      assert %{
        "success" => false,
        "error" => "Invalid service name",
        "valid_services" => ["baml_service"]
      } = json_response(conn, 400)
    end

    test "handles missing service parameter", %{conn: conn} do
      conn = post(conn, ~p"/internal/processing/circuit-breaker/reset", %{})
      
      # This should trigger a function clause error and return 400
      assert response(conn, 400)
    end
  end
end