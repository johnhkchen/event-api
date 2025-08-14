defmodule EventAPIWeb.Internal.GraphControllerTest do
  use EventAPIWeb.ConnCase, async: true

  describe "GET /internal/graph/:query" do
    test "returns response for graph query", %{conn: conn} do
      query = "speakers"
      conn = get(conn, ~p"/internal/graph/#{query}")

      # Since GraphService is a stub, it should return basic response
      assert %{"success" => true, "data" => data} = json_response(conn, 200)
      assert is_map(data)
    end

    test "handles URL encoded query parameter", %{conn: conn} do
      encoded_query = "speakers%20at%20events"
      conn = get(conn, "/internal/graph/#{encoded_query}")

      assert %{"success" => true} = json_response(conn, 200)
    end
  end

  describe "GET /internal/graph/speaker/:speaker_id" do
    test "returns response for speaker graph", %{conn: conn} do
      speaker_id = "123"
      conn = get(conn, ~p"/internal/graph/speaker/#{speaker_id}")

      # Since GraphService is a stub, it should return basic response
      assert %{"success" => true, "data" => data} = json_response(conn, 200)
      assert is_map(data)
    end
  end
end