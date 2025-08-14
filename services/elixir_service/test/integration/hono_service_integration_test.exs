defmodule EventApiWeb.Integration.HonoServiceIntegrationTest do
  @moduledoc """
  Integration tests for Elixir → Hono service communication.
  
  These tests verify:
  - Internal API endpoint responses
  - Cross-service communication patterns
  - Error propagation between services
  - Health check coordination
  """

  use EventApiWeb.IntegrationCase
  
  @moduletag :integration

  describe "internal API endpoints" do
    test "POST /internal/process accepts valid processing requests" do
      event_data = %{
        "title" => "Test Event",
        "description" => "A test event for integration testing",
        "url" => "https://example.com/event",
        "html_content" => "<html><body><h1>Test Event</h1></body></html>"
      }

      conn = build_conn()
             |> put_req_header("content-type", "application/json")
             |> post("/api/internal/process", Jason.encode!(event_data))

      assert json_response(conn, 200)
      response = json_response(conn, 200)
      assert Map.has_key?(response, "job_id")
      assert Map.has_key?(response, "status")
    end

    test "POST /internal/process validates required fields" do
      invalid_data = %{"title" => "Test Event"}

      conn = build_conn()
             |> put_req_header("content-type", "application/json")
             |> post("/api/internal/process", Jason.encode!(invalid_data))

      assert json_response(conn, 400)
      response = json_response(conn, 400)
      assert Map.has_key?(response, "error")
    end

    test "POST /internal/graph/query handles graph queries" do
      query_data = %{
        "query" => "MATCH (e:Event) WHERE e.title CONTAINS 'Tech' RETURN e LIMIT 5",
        "parameters" => %{}
      }

      conn = build_conn()
             |> put_req_header("content-type", "application/json")
             |> post("/api/internal/graph/query", Jason.encode!(query_data))

      # Should return 200 even if no data matches
      assert json_response(conn, 200)
      response = json_response(conn, 200)
      assert Map.has_key?(response, "results")
    end

    test "POST /internal/deduplicate processes deduplication requests" do
      entities = [
        %{
          "name" => "John Doe",
          "email" => "john@example.com",
          "company" => "TechCorp"
        },
        %{
          "name" => "John D.",
          "email" => "john@example.com", 
          "company" => "TechCorp Inc"
        }
      ]

      dedup_data = %{
        "entities" => entities,
        "entity_type" => "speaker"
      }

      conn = build_conn()
             |> put_req_header("content-type", "application/json")
             |> post("/api/internal/deduplicate", Jason.encode!(dedup_data))

      assert json_response(conn, 200)
      response = json_response(conn, 200)
      assert Map.has_key?(response, "deduplicated_entities")
      assert Map.has_key?(response, "merge_candidates")
    end

    test "GET /internal/health returns service status" do
      conn = build_conn()
             |> get("/api/internal/health")

      assert json_response(conn, 200)
      response = json_response(conn, 200)
      assert response["status"] == "healthy"
      assert Map.has_key?(response, "services")
      assert Map.has_key?(response, "timestamp")
    end
  end

  describe "error handling and resilience" do
    test "handles BAML service unavailability gracefully" do
      # Temporarily disable BAML service
      original_url = Application.get_env(:event_api, :baml_service_url)
      Application.put_env(:event_api, :baml_service_url, "http://localhost:9999")
      
      try do
        event_data = %{
          "title" => "Test Event",
          "description" => "Test description",
          "url" => "https://example.com/event",
          "html_content" => "<html><body><h1>Test</h1></body></html>"
        }

        conn = build_conn()
               |> put_req_header("content-type", "application/json")
               |> post("/api/internal/process", Jason.encode!(event_data))

        # Should still accept the job but mark BAML as unavailable
        assert json_response(conn, 200)
        response = json_response(conn, 200)
        assert Map.has_key?(response, "job_id")
        # Job should be queued for retry when service is available
        assert response["status"] in ["queued", "pending"]
      after
        Application.put_env(:event_api, :baml_service_url, original_url)
      end
    end

    test "validates request payload size limits" do
      # Create very large payload
      large_content = String.duplicate("<p>Large content block</p>", 10000)
      
      event_data = %{
        "title" => "Large Event",
        "description" => "Event with large content",
        "url" => "https://example.com/large-event",
        "html_content" => large_content
      }

      conn = build_conn()
             |> put_req_header("content-type", "application/json")
             |> post("/api/internal/process", Jason.encode!(event_data))

      # Should either accept and handle properly or reject with clear error
      response_status = conn.status
      assert response_status in [200, 413, 422]
      
      if response_status != 200 do
        response = json_response(conn, response_status)
        assert Map.has_key?(response, "error")
      end
    end

    test "handles concurrent processing requests" do
      # Send multiple requests concurrently
      tasks = for i <- 1..5 do
        Task.async(fn ->
          event_data = %{
            "title" => "Concurrent Event #{i}",
            "description" => "Concurrent test event",
            "url" => "https://example.com/event-#{i}",
            "html_content" => "<html><body><h1>Event #{i}</h1></body></html>"
          }

          build_conn()
          |> put_req_header("content-type", "application/json")
          |> post("/api/internal/process", Jason.encode!(event_data))
        end)
      end

      results = Task.await_many(tasks, 10_000)
      
      # All requests should succeed
      Enum.each(results, fn conn ->
        assert json_response(conn, 200)
        response = json_response(conn, 200)
        assert Map.has_key?(response, "job_id")
      end)

      # All job IDs should be unique
      job_ids = Enum.map(results, fn conn ->
        json_response(conn, 200)["job_id"]
      end)
      
      assert length(Enum.uniq(job_ids)) == 5
    end

    test "handles malformed JSON gracefully" do
      malformed_json = "{invalid: json content"

      conn = build_conn()
             |> put_req_header("content-type", "application/json")
             |> post("/api/internal/process", malformed_json)

      assert json_response(conn, 400)
      response = json_response(conn, 400)
      assert Map.has_key?(response, "error")
      assert response["error"] =~ "invalid_json" or response["error"] =~ "parse_error"
    end
  end

  describe "service coordination" do
    test "health checks reflect BAML service status" do
      conn = build_conn()
             |> get("/api/internal/health")

      assert json_response(conn, 200)
      response = json_response(conn, 200)
      
      assert Map.has_key?(response, "services")
      assert Map.has_key?(response["services"], "baml")
      assert Map.has_key?(response["services"], "database")
      assert Map.has_key?(response["services"], "oban")
    end

    test "processing queue status is accessible" do
      conn = build_conn()
             |> get("/api/internal/health")

      assert json_response(conn, 200)
      response = json_response(conn, 200)
      
      # Should include queue statistics
      assert Map.has_key?(response, "services")
      oban_status = response["services"]["oban"]
      assert Map.has_key?(oban_status, "status")
    end

    test "service discovery works for recommendations" do
      conn = build_conn()
             |> get("/api/internal/recommend/events?user_id=test&limit=5")

      # Should return valid recommendation response
      assert json_response(conn, 200)
      response = json_response(conn, 200)
      assert Map.has_key?(response, "recommendations")
      assert is_list(response["recommendations"])
    end
  end

  describe "data consistency" do
    test "processing preserves data integrity" do
      event_data = %{
        "title" => "Data Integrity Test",
        "description" => "Testing data consistency across services",
        "url" => "https://example.com/integrity-test",
        "html_content" => """
        <html>
          <body>
            <h1>Data Integrity Test</h1>
            <p>Speaker: Alice Johnson</p>
            <p>Company: DataCorp</p>
            <p>Email: alice@datacorp.com</p>
          </body>
        </html>
        """,
        "source_id" => "test-source-#{System.unique_integer()}"
      }

      conn = build_conn()
             |> put_req_header("content-type", "application/json")
             |> post("/api/internal/process", Jason.encode!(event_data))

      assert json_response(conn, 200)
      response = json_response(conn, 200)
      job_id = response["job_id"]
      
      # Verify job was created and can be tracked
      assert is_binary(job_id)
      assert String.length(job_id) > 0
    end

    test "duplicate processing is handled correctly" do
      event_data = %{
        "title" => "Duplicate Test Event",
        "description" => "Testing duplicate handling",
        "url" => "https://example.com/duplicate-test",
        "html_content" => "<html><body><h1>Duplicate Event</h1></body></html>",
        "source_id" => "duplicate-test-#{System.unique_integer()}"
      }

      # Send the same event twice
      conn1 = build_conn()
              |> put_req_header("content-type", "application/json")
              |> post("/api/internal/process", Jason.encode!(event_data))

      conn2 = build_conn()
              |> put_req_header("content-type", "application/json")
              |> post("/api/internal/process", Jason.encode!(event_data))

      assert json_response(conn1, 200)
      assert json_response(conn2, 200)
      
      response1 = json_response(conn1, 200)
      response2 = json_response(conn2, 200)
      
      # Should either have same job_id or indicate duplicate handling
      assert response1["job_id"] == response2["job_id"] or 
             response2["status"] == "duplicate" or
             response2["status"] == "ignored"
    end
  end
end