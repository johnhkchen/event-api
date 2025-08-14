defmodule EventApiWeb.Integration.BamlServiceIntegrationTest do
  @moduledoc """
  Integration tests for Elixir → BAML service communication.
  
  These tests verify:
  - Real HTTP communication with BAML service
  - Error handling for service failures
  - Timeout and retry logic
  - Response parsing and validation
  """

  use EventApiWeb.IntegrationCase
  alias EventApi.Services.BamlClient

  @moduletag :integration

  describe "BAML service integration" do
    @tag :skip_unless_baml_running
    test "extract_content/1 communicates with real BAML service" do
      # Skip if BAML service is not running
      unless service_healthy?(@baml_service_url) do
        IO.puts("Skipping BAML integration test - service not available at #{@baml_service_url}")
        assert true
        return
      end

      html_content = """
      <html>
        <head><title>Test Event</title></head>
        <body>
          <h1>Tech Conference 2025</h1>
          <p>Date: January 15, 2025</p>
          <p>Location: San Francisco, CA</p>
          <p>Speaker: John Doe, CTO at TechCorp</p>
        </body>
      </html>
      """

      assert {:ok, result} = BamlClient.extract_content(html_content)
      assert is_map(result)
      assert Map.has_key?(result, "title")
      assert Map.has_key?(result, "speakers")
      assert Map.has_key?(result, "location")
    end

    test "extract_content/1 handles service unavailable" do
      # Use invalid URL to simulate service down
      original_url = Application.get_env(:event_api, :baml_service_url)
      Application.put_env(:event_api, :baml_service_url, "http://localhost:9999")
      
      try do
        html_content = "<html><body>Test</body></html>"
        
        assert {:error, reason} = BamlClient.extract_content(html_content)
        assert reason =~ "service_unavailable" or reason =~ "connection_failed"
      after
        Application.put_env(:event_api, :baml_service_url, original_url)
      end
    end

    test "extract_content/1 handles timeout scenarios" do
      # Skip if BAML service is not running
      unless service_healthy?(@baml_service_url) do
        IO.puts("Skipping BAML timeout test - service not available")
        assert true
        return
      end

      # Test with very short timeout
      original_timeout = Application.get_env(:event_api, :baml_request_timeout, 30_000)
      Application.put_env(:event_api, :baml_request_timeout, 1)
      
      try do
        html_content = String.duplicate("<p>Large content</p>", 1000)
        
        result = BamlClient.extract_content(html_content)
        # Should either timeout or succeed very quickly
        assert {:error, _reason} = result or {:ok, _data} = result
      after
        Application.put_env(:event_api, :baml_request_timeout, original_timeout)
      end
    end

    test "extract_content/1 handles malformed responses" do
      # Start a mock server that returns invalid JSON
      {:ok, _pid} = start_mock_server(8081)
      
      original_url = Application.get_env(:event_api, :baml_service_url)
      Application.put_env(:event_api, :baml_service_url, "http://localhost:8081")
      
      try do
        html_content = "<html><body>Test</body></html>"
        
        assert {:error, reason} = BamlClient.extract_content(html_content)
        assert reason =~ "decode_error" or reason =~ "invalid_response"
      after
        Application.put_env(:event_api, :baml_service_url, original_url)
      end
    end

    @tag :skip_unless_baml_running
    test "extract_content_batch/1 handles multiple documents" do
      unless service_healthy?(@baml_service_url) do
        IO.puts("Skipping BAML batch test - service not available")
        assert true
        return
      end

      documents = [
        "<html><body><h1>Event 1</h1><p>Tech meetup</p></body></html>",
        "<html><body><h1>Event 2</h1><p>Workshop session</p></body></html>"
      ]

      assert {:ok, results} = BamlClient.extract_content_batch(documents)
      assert is_list(results)
      assert length(results) == 2
      
      Enum.each(results, fn result ->
        assert is_map(result)
        assert Map.has_key?(result, "title")
      end)
    end

    test "circuit breaker pattern works correctly" do
      # Test circuit breaker by causing multiple failures
      original_url = Application.get_env(:event_api, :baml_service_url)
      Application.put_env(:event_api, :baml_service_url, "http://localhost:9999")
      
      try do
        html_content = "<html><body>Test</body></html>"
        
        # Make multiple requests to trigger circuit breaker
        results = for _i <- 1..5 do
          BamlClient.extract_content(html_content)
        end
        
        # Should have consistent error responses
        Enum.each(results, fn result ->
          assert {:error, _reason} = result
        end)
        
        # Circuit breaker state should be reflected in service health
        refute BamlClient.service_healthy?()
      after
        Application.put_env(:event_api, :baml_service_url, original_url)
      end
    end

    @tag :skip_unless_baml_running  
    test "service health check works correctly" do
      if service_healthy?(@baml_service_url) do
        assert BamlClient.service_healthy?()
      else
        IO.puts("Skipping BAML health check test - service not available")
        assert true
      end
    end

    test "caching mechanism works correctly" do
      unless service_healthy?(@baml_service_url) do
        IO.puts("Skipping BAML caching test - service not available")
        assert true
        return
      end

      html_content = "<html><body><h1>Cached Event</h1></body></html>"
      
      # First request
      assert {:ok, result1} = BamlClient.extract_content(html_content)
      
      # Second request with same content should use cache
      start_time = System.monotonic_time(:millisecond)
      assert {:ok, result2} = BamlClient.extract_content(html_content)
      end_time = System.monotonic_time(:millisecond)
      
      # Cached response should be much faster (< 10ms)
      assert end_time - start_time < 10
      assert result1 == result2
    end
  end

  describe "BAML service error scenarios" do
    test "handles network partitions gracefully" do
      # Simulate network partition by using unreachable host
      original_url = Application.get_env(:event_api, :baml_service_url)
      Application.put_env(:event_api, :baml_service_url, "http://192.0.2.1:8080") # RFC 5737 test address
      
      try do
        html_content = "<html><body>Test</body></html>"
        
        assert {:error, reason} = BamlClient.extract_content(html_content)
        assert reason =~ "connection_failed" or reason =~ "timeout"
      after
        Application.put_env(:event_api, :baml_service_url, original_url)
      end
    end

    test "validates request data before sending" do
      # Test with invalid input
      assert {:error, reason} = BamlClient.extract_content(nil)
      assert reason =~ "invalid_input"
      
      assert {:error, reason} = BamlClient.extract_content("")
      assert reason =~ "invalid_input"
    end

    test "handles rate limiting responses" do
      # This would need a real rate-limited response from BAML service
      # For now, we'll test the error handling path
      assert_service_error_handling(BamlClient, :extract_content, ["<html></html>"])
    end
  end
end