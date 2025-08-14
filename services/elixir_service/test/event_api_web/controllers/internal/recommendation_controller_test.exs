defmodule EventAPIWeb.Internal.RecommendationControllerTest do
  use EventAPIWeb.ConnCase, async: true

  describe "POST /internal/recommend/events" do
    test "returns event recommendations for user profile", %{conn: conn} do
      user_profile = %{
        "interests" => ["AI", "Machine Learning"],
        "location" => "San Francisco",
        "experience_level" => "senior",
        "preferred_formats" => ["conference", "workshop"]
      }

      conn = post(conn, ~p"/internal/recommend/events", user_profile)

      assert %{"success" => true, "data" => data} = json_response(conn, 200)
      assert is_map(data)
    end

    test "handles empty user profile", %{conn: conn} do
      user_profile = %{}

      conn = post(conn, ~p"/internal/recommend/events", user_profile)

      # The stub service should handle this gracefully
      assert %{"success" => true} = json_response(conn, 200)
    end
  end

  describe "GET /internal/recommend/similar/:event_id" do
    test "returns similar events for valid event ID", %{conn: conn} do
      event_id = "event_123"

      conn = get(conn, ~p"/internal/recommend/similar/#{event_id}")

      assert %{"success" => true, "data" => data} = json_response(conn, 200)
      assert is_map(data)
    end
  end

  describe "GET /internal/recommend/speakers/:speaker_id" do
    test "returns speaker recommendations", %{conn: conn} do
      speaker_id = "speaker_123"

      conn = get(conn, ~p"/internal/recommend/speakers/#{speaker_id}")

      assert %{"success" => true, "data" => data} = json_response(conn, 200)
      assert is_map(data)
    end
  end
end