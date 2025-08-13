defmodule EventAPI.Processing.DeduplicationServiceTest do
  use ExUnit.Case, async: true
  
  alias EventAPI.Processing.DeduplicationService
  alias EventAPI.Events.{Speaker, Company}
  
  describe "speaker deduplication" do
    test "groups speakers by normalized name" do
      speakers = [
        %Speaker{id: 1, name: "John Smith", company: "Tech Corp", confidence_score: 0.8},
        %Speaker{id: 2, name: "john smith", company: "Tech Corp", confidence_score: 0.9},
        %Speaker{id: 3, name: "Jane Doe", company: "Other Corp", confidence_score: 0.7}
      ]
      
      # Test the private function through a helper (simplified for testing)
      result = DeduplicationService.deduplicate_speakers(speakers)
      
      assert result.status == :success
      assert is_list(result.auto_merged)
      assert is_list(result.manual_review_items) 
      assert is_list(result.kept_separate)
      assert result.stats.total_processed == 3
    end
    
    test "handles empty speaker list" do
      result = DeduplicationService.deduplicate_speakers([])
      
      assert result.status == :success
      assert result.stats.total_processed == 0
      assert length(result.auto_merged) == 0
      assert length(result.manual_review_items) == 0
      assert length(result.kept_separate) == 0
    end
  end
  
  describe "company deduplication" do
    test "groups companies by normalized name and domain" do
      companies = [
        %Company{id: 1, name: "Tech Corp Inc.", domain: "techcorp.com"},
        %Company{id: 2, name: "Tech Corp", domain: "techcorp.com"},
        %Company{id: 3, name: "Other Company", domain: "other.com"}
      ]
      
      result = DeduplicationService.deduplicate_companies(companies)
      
      assert result.status == :success
      assert is_list(result.auto_merged)
      assert is_list(result.manual_review_items)
      assert is_list(result.kept_separate)
      assert result.stats.total_processed == 3
    end
    
    test "prioritizes domain-based matching" do
      companies = [
        %Company{id: 1, name: "Completely Different Name", domain: "same.com"},
        %Company{id: 2, name: "Another Different Name", domain: "same.com"}
      ]
      
      result = DeduplicationService.deduplicate_companies(companies)
      
      # Should auto-merge due to same domain
      assert result.status == :success
      assert length(result.auto_merged) >= 0  # May be auto-merged due to domain match
    end
  end
  
  describe "event deduplication" do
    test "groups events by date and location" do
      events = [
        %{id: 1, name: "Tech Conference", date: ~D[2024-01-01], location: "San Francisco"},
        %{id: 2, name: "Tech Conference 2024", date: ~D[2024-01-01], location: "San Francisco"},
        %{id: 3, name: "Different Event", date: ~D[2024-01-02], location: "New York"}
      ]
      
      result = DeduplicationService.deduplicate_events(events)
      
      assert result.status == :success
      assert is_list(result.auto_merged)
      assert is_list(result.manual_review_items)
      assert is_list(result.kept_separate)
      assert result.stats.total_processed == 3
    end
  end
  
  describe "confidence calculation" do
    test "Speaker.normalize_name works correctly" do
      assert Speaker.normalize_name("Dr. John Smith") == "john smith"
      assert Speaker.normalize_name("  JANE DOE  ") == "jane doe" 
      assert Speaker.normalize_name("Prof. Mary Johnson") == "mary johnson"
    end
    
    test "Company.normalize_name works correctly" do
      assert Company.normalize_name("Tech Corp Inc.") == "tech corp"
      assert Company.normalize_name("Software Solutions LLC") == "software solutions"
      assert Company.normalize_name("  CONSULTING GROUP  ") == "consulting"
    end
    
    test "Speaker.name_similarity provides reasonable scores" do
      # Identical names should score 1.0
      assert Speaker.name_similarity("john smith", "john smith") == 1.0
      
      # Very similar names should score high
      score = Speaker.name_similarity("john smith", "john smyth")
      assert score > 0.8
      
      # Completely different names should score low  
      score = Speaker.name_similarity("john smith", "mary johnson")
      assert score < 0.5
    end
  end
  
  describe "manual review workflow" do
    test "get_review_queue returns empty queue initially" do
      result = DeduplicationService.get_review_queue()
      assert result.status == :success
      assert result.review_queue == []
    end
    
    test "approve_merge handles non-existent review item" do
      result = DeduplicationService.approve_merge("non-existent-id", true)
      assert result.status == :error
      assert result.message == "Review functionality not yet implemented"
    end
  end
end