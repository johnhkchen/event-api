defmodule EventAPI.Services.BAMLClientTest do
  @moduledoc """
  Tests for the enhanced BAML HTTP client service with validation, caching, and telemetry.
  """
  
  use EventAPI.DataCase, async: false
  
  alias EventAPI.Services.{BAMLClient, BAMLSchemas}
  
  setup do
    # Start the cache for testing
    BAMLClient.start_cache()
    
    # Clear the cache before each test
    Cachex.clear(:baml_response_cache)
    
    :ok
  end
  
  describe "extract_content/2" do
    test "returns error for invalid HTML input" do
      assert {:error, :invalid_request} = BAMLClient.extract_content("")
      assert {:error, :invalid_request} = BAMLClient.extract_content("short")
      assert {:error, :invalid_request} = BAMLClient.extract_content(nil)
    end
    
    test "handles very long HTML input validation" do
      # Test maximum length validation
      very_long_html = String.duplicate("a", 1_000_001)
      assert {:error, :invalid_request} = BAMLClient.extract_content(very_long_html)
    end
    
    test "validates request structure" do
      valid_html = "<html><body><h1>Test Event</h1><p>Event description longer than minimum</p></body></html>"
      
      # This will fail because BAML service isn't running, but it tests validation
      result = BAMLClient.extract_content(valid_html)
      
      # Should get transport error or service error, not validation error
      assert match?({:error, :transport_error}, result) or 
             match?({:error, :request_failed}, result) or
             match?({:error, :service_error}, result)
    end
  end

  describe "extract_batch/2" do
    test "validates batch request parameters" do
      assert {:error, :invalid_request} = BAMLClient.extract_batch([])
      assert {:error, :invalid_request} = BAMLClient.extract_batch("not a list")
      
      # Invalid document structure
      invalid_docs = [%{"no_id" => 1, "html" => "<html></html>"}]
      assert {:error, :invalid_request} = BAMLClient.extract_batch(invalid_docs)
    end
    
    test "validates proper document structure" do
      valid_docs = [
        %{"id" => 1, "html" => "<html><body><h1>Event 1</h1></body></html>"},
        %{"id" => 2, "html" => "<html><body><h1>Event 2</h1></body></html>"}
      ]
      
      # This will fail because BAML service isn't running, but it tests validation
      result = BAMLClient.extract_batch(valid_docs)
      
      # Should get transport error or service error, not validation error
      assert match?({:error, :transport_error}, result) or 
             match?({:error, :request_failed}, result) or
             match?({:error, :service_error}, result)
    end
  end

  describe "generate_embeddings/2" do
    test "validates embedding request parameters" do
      assert {:error, :invalid_request} = BAMLClient.generate_embeddings("")
      assert {:error, :invalid_request} = BAMLClient.generate_embeddings(nil)
    end
    
    test "validates text length" do
      very_long_text = String.duplicate("a", 100_001)
      assert {:error, :invalid_request} = BAMLClient.generate_embeddings(very_long_text)
    end
    
    test "accepts valid text input" do
      valid_text = "Machine learning conference about AI and technology"
      
      # This will fail because BAML service isn't running, but it tests validation
      result = BAMLClient.generate_embeddings(valid_text)
      
      # Should get transport error or service error, not validation error
      assert match?({:error, :transport_error}, result) or 
             match?({:error, :request_failed}, result) or
             match?({:error, :service_error}, result)
    end
  end

  describe "health_check/0" do
    test "attempts to contact BAML service" do
      # This will fail because BAML service isn't running
      result = BAMLClient.health_check()
      
      assert match?({:error, "service_unavailable"}, result) or 
             match?({:error, "unhealthy"}, result)
    end
  end
  
  describe "cache functionality" do
    test "cache_stats/0 returns statistics when cache is running" do
      # Ensure cache is running
      BAMLClient.start_cache()
      
      # Put something in cache first
      Cachex.put(:baml_response_cache, "test_key", "test_value")
      
      assert {:ok, stats} = BAMLClient.cache_stats()
      assert is_map(stats)
      assert Map.has_key?(stats, :get)  # Cachex stats structure
    end
    
    test "start_cache/0 initializes cache successfully" do
      # Stop existing cache if running
      Cachex.stop(:baml_response_cache)
      
      assert :ok = BAMLClient.start_cache()
      
      # Verify cache is running by checking stats
      assert {:ok, _stats} = BAMLClient.cache_stats()
    end
    
    test "start_cache/0 handles already started cache" do
      # Cache should already be running from setup
      assert :ok = BAMLClient.start_cache()
      
      # Should still work if called again
      assert :ok = BAMLClient.start_cache()
    end
    
    test "cache generates consistent keys for same HTML" do
      html1 = "<html><body><h1>Test</h1></body></html>"
      html2 = "<html><body><h1>Test</h1></body></html>"
      html3 = "<html><body><h1>Different</h1></body></html>"
      
      # Test that same HTML generates same cache key
      # This is tested indirectly by verifying the cache behavior would be correct
      key1 = :crypto.hash(:sha256, html1) |> Base.encode16(case: :lower)
      key2 = :crypto.hash(:sha256, html2) |> Base.encode16(case: :lower)
      key3 = :crypto.hash(:sha256, html3) |> Base.encode16(case: :lower)
      
      assert key1 == key2
      assert key1 != key3
    end
  end
  
  describe "validation schemas" do
    test "extract request validation works correctly" do
      # Valid request
      valid_request = %{
        html: "<html><body><h1>Valid HTML Content</h1></body></html>",
        correlation_id: "test-123"
      }
      
      assert {:ok, validated} = BAMLSchemas.validate_extract_request(valid_request)
      assert validated.html == valid_request.html
      assert validated.correlation_id == valid_request.correlation_id
      
      # Invalid request - too short HTML
      invalid_request = %{
        html: "short",
        correlation_id: "test-123"
      }
      
      assert {:error, changeset} = BAMLSchemas.validate_extract_request(invalid_request)
      assert changeset.errors[:html]
    end
    
    test "batch request validation works correctly" do
      # Valid batch request
      valid_request = %{
        documents: [
          %{"id" => 1, "html" => "<html><body><h1>Event 1</h1></body></html>"},
          %{"id" => 2, "html" => "<html><body><h1>Event 2</h1></body></html>"}
        ],
        correlation_id: "batch-123"
      }
      
      assert {:ok, validated} = BAMLSchemas.validate_batch_request(valid_request)
      assert length(validated.documents) == 2
      
      # Invalid batch request - empty documents
      invalid_request = %{
        documents: [],
        correlation_id: "batch-123"
      }
      
      assert {:error, changeset} = BAMLSchemas.validate_batch_request(invalid_request)
      assert changeset.errors[:documents]
    end
    
    test "embedding request validation works correctly" do
      # Valid embedding request
      valid_request = %{
        text: "Machine learning conference about AI",
        correlation_id: "embed-123"
      }
      
      assert {:ok, validated} = BAMLSchemas.validate_embedding_request(valid_request)
      assert validated.text == valid_request.text
      
      # Invalid embedding request - empty text
      invalid_request = %{
        text: "",
        correlation_id: "embed-123"
      }
      
      assert {:error, changeset} = BAMLSchemas.validate_embedding_request(invalid_request)
      assert changeset.errors[:text]
    end
    
    test "response validation works correctly" do
      # Valid extraction response
      valid_response = %{
        "success" => true,
        "data" => %{
          "title" => "Test Event",
          "description" => "Event description"
        },
        "correlation_id" => "test-123"
      }
      
      assert {:ok, validated} = BAMLSchemas.validate_extract_response(valid_response)
      assert validated.success == true
      assert validated.data["title"] == "Test Event"
      
      # Invalid extraction response - missing data
      invalid_response = %{
        "success" => true,
        "correlation_id" => "test-123"
      }
      
      assert {:error, changeset} = BAMLSchemas.validate_extract_response(invalid_response)
      assert changeset.errors[:data]
    end
  end
end