defmodule EventAPIWeb.Internal.DeduplicationControllerTest do
  use EventAPIWeb.ConnCase, async: true

  describe "POST /internal/deduplicate" do
    test "processes speaker deduplication request", %{conn: conn} do
      request_params = %{
        "entity_type" => "speakers",
        "data" => [
          %{"name" => "John Doe", "email" => "john@example.com"},
          %{"name" => "J. Doe", "email" => "john@example.com"}
        ]
      }

      conn = post(conn, ~p"/internal/deduplicate", request_params)

      assert %{"success" => true, "data" => data} = json_response(conn, 202)
      assert is_map(data)
    end

    test "processes company deduplication request", %{conn: conn} do
      request_params = %{
        "entity_type" => "companies",
        "data" => [
          %{"name" => "Google Inc.", "domain" => "google.com"},
          %{"name" => "Google LLC", "domain" => "google.com"}
        ]
      }

      conn = post(conn, ~p"/internal/deduplicate", request_params)

      assert %{"success" => true} = json_response(conn, 202)
    end

    test "processes event deduplication request", %{conn: conn} do
      request_params = %{
        "entity_type" => "events",
        "data" => [
          %{"title" => "AI Conference 2024", "date" => "2024-03-15"},
          %{"title" => "AI Conference 2024", "date" => "2024-03-15"}
        ]
      }

      conn = post(conn, ~p"/internal/deduplicate", request_params)

      assert %{"success" => true} = json_response(conn, 202)
    end

    test "handles batch deduplication request", %{conn: conn} do
      request_params = %{
        "entity_type" => "speakers",
        "batch_size" => 100,
        "batch_opts" => %{
          "confidence_threshold" => 0.9,
          "auto_merge_enabled" => true
        }
      }

      conn = post(conn, ~p"/internal/deduplicate", request_params)

      assert %{"success" => true} = json_response(conn, 202)
    end

    test "rejects invalid entity type", %{conn: conn} do
      request_params = %{
        "entity_type" => "invalid_type",
        "data" => []
      }

      conn = post(conn, ~p"/internal/deduplicate", request_params)

      assert %{"success" => false, "error" => "Invalid parameters"} = json_response(conn, 400)
    end

    test "rejects missing entity_type", %{conn: conn} do
      request_params = %{
        "data" => [%{"name" => "test"}]
      }

      conn = post(conn, ~p"/internal/deduplicate", request_params)

      assert %{"success" => false, "error" => "Invalid parameters"} = json_response(conn, 400)
    end
  end
end