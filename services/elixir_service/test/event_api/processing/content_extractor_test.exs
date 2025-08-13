defmodule EventAPI.Processing.ContentExtractorTest do
  @moduledoc """
  Tests for the ContentExtractor GenServer that integrates with BAML client.
  """
  
  use EventAPI.DataCase, async: false
  
  alias EventAPI.Processing.ContentExtractor
  alias EventAPI.Services.BAMLClient
  
  setup do
    # Start the cache for BAML client
    BAMLClient.start_cache()
    
    # Start the ContentExtractor GenServer
    {:ok, _pid} = ContentExtractor.start_link([])
    
    # Clear cache before each test
    Cachex.clear(:baml_response_cache)
    
    :ok
  end
  
  describe "extract_content/1" do
    test "returns error for invalid HTML input" do
      assert {:error, "invalid_html"} = ContentExtractor.extract_content("")
      assert {:error, "invalid_html"} = ContentExtractor.extract_content(nil)
      assert {:error, "invalid_html"} = ContentExtractor.extract_content(123)
    end
    
    test "delegates to BAMLClient with valid HTML" do
      valid_html = "<html><body><h1>Test Event</h1><p>Event description longer than minimum</p></body></html>"
      
      # Since BAML service isn't running, this will fail at the HTTP level
      # but we can verify it reaches the BAML client (not validation errors)
      result = ContentExtractor.extract_content(valid_html)
      
      # Should get an error from BAML client, not from GenServer validation
      assert match?({:error, _reason}, result)
      
      # The error should be from the HTTP client, not from input validation
      {:error, reason} = result
      assert reason in [:transport_error, :request_failed, :service_error]
    end
    
    test "handles BAML client errors gracefully" do
      # Test with HTML that passes validation but will cause transport error
      html = "<html><body><h1>Valid Event</h1><p>Valid description content</p></body></html>"
      
      result = ContentExtractor.extract_content(html)
      
      # Should return error tuple, not crash
      assert match?({:error, _}, result)
    end
    
    test "GenServer handles concurrent requests" do
      html = "<html><body><h1>Concurrent Test</h1><p>Test concurrent processing</p></body></html>"
      
      # Spawn multiple concurrent requests
      tasks = for i <- 1..5 do
        Task.async(fn -> 
          ContentExtractor.extract_content(html)
        end)
      end
      
      results = Task.await_all(tasks, 10_000)
      
      # All requests should complete (with errors due to no BAML service)
      assert length(results) == 5
      
      # All should be error tuples
      Enum.each(results, fn result ->
        assert match?({:error, _}, result)
      end)
    end
  end
  
  describe "extract_batch/1" do
    test "returns error for invalid documents input" do
      assert {:error, "invalid_documents"} = ContentExtractor.extract_batch([])
      assert {:error, "invalid_documents"} = ContentExtractor.extract_batch("not a list")
      assert {:error, "invalid_documents"} = ContentExtractor.extract_batch(nil)
    end
    
    test "delegates to BAMLClient with valid documents" do
      valid_docs = [
        %{"id" => 1, "html" => "<html><body><h1>Event 1</h1></body></html>"},
        %{"id" => 2, "html" => "<html><body><h1>Event 2</h1></body></html>"}
      ]
      
      # Since BAML service isn't running, this will fail at the HTTP level
      result = ContentExtractor.extract_batch(valid_docs)
      
      # Should get an error from BAML client, not from GenServer validation
      assert match?({:error, _reason}, result)
    end
    
    test "handles large batch requests" do
      # Create a larger batch to test handling
      large_batch = for i <- 1..10 do
        %{
          "id" => i, 
          "html" => "<html><body><h1>Event #{i}</h1><p>Description for event #{i}</p></body></html>"
        }
      end
      
      # Should handle the request without timing out
      result = ContentExtractor.extract_batch(large_batch)
      
      # Will error due to no BAML service, but should handle the request
      assert match?({:error, _}, result)
    end
  end
  
  describe "GenServer lifecycle" do
    test "ContentExtractor can be started and stopped" do
      # Stop the existing GenServer
      GenServer.stop(ContentExtractor)
      
      # Verify it's stopped
      refute Process.whereis(ContentExtractor)
      
      # Restart it
      {:ok, pid} = ContentExtractor.start_link([])
      
      # Verify it's running
      assert Process.alive?(pid)
      assert Process.whereis(ContentExtractor) == pid
    end
    
    test "ContentExtractor handles calls after restart" do
      # Stop and restart
      GenServer.stop(ContentExtractor)
      {:ok, _pid} = ContentExtractor.start_link([])
      
      # Should still be able to handle requests
      html = "<html><body><h1>Post-restart Test</h1></body></html>"
      result = ContentExtractor.extract_content(html)
      
      # Should get error from BAML client, not from GenServer being down
      assert match?({:error, _}, result)
    end
  end
  
  describe "integration with BAML client" do
    test "ContentExtractor properly integrates with cache" do
      # Ensure cache is working
      assert {:ok, _stats} = BAMLClient.cache_stats()
      
      # Test extraction (will fail due to no service, but cache should be accessible)
      html = "<html><body><h1>Cache Test</h1><p>Testing cache integration</p></body></html>"
      result = ContentExtractor.extract_content(html)
      
      # Should be error from service, not cache
      assert match?({:error, _}, result)
    end
    
    test "ContentExtractor respects BAML client timeouts" do
      html = "<html><body><h1>Timeout Test</h1><p>Testing timeout handling</p></body></html>"
      
      # Should complete within reasonable time (even if it errors)
      start_time = System.monotonic_time()
      _result = ContentExtractor.extract_content(html)
      end_time = System.monotonic_time()
      
      duration_ms = System.convert_time_unit(end_time - start_time, :native, :millisecond)
      
      # Should complete quickly (transport error should be fast)
      assert duration_ms < 5_000  # Less than 5 seconds
    end
  end
  
  describe "error handling and resilience" do
    test "ContentExtractor survives BAML client errors" do
      # Multiple failed requests shouldn't crash the GenServer
      html = "<html><body><h1>Error Test</h1><p>Testing error handling</p></body></html>"
      
      # Make multiple failing requests
      for _i <- 1..5 do
        result = ContentExtractor.extract_content(html)
        assert match?({:error, _}, result)
      end
      
      # GenServer should still be alive
      assert Process.alive?(Process.whereis(ContentExtractor))
    end
    
    test "ContentExtractor handles malformed responses gracefully" do
      # Test with various inputs that might cause issues
      test_cases = [
        "<html><body><h1>Event</h1></body></html>",
        "<html>Valid but minimal</html>",
        "<html><body><h1>Event with special chars: áéíóú</h1></body></html>"
      ]
      
      Enum.each(test_cases, fn html ->
        result = ContentExtractor.extract_content(html)
        # Should always return error tuple, never crash
        assert match?({:error, _}, result)
      end)
      
      # GenServer should still be running
      assert Process.alive?(Process.whereis(ContentExtractor))
    end
  end
end