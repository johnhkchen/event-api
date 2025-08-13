defmodule EventAPI.EventsTest do
  @moduledoc """
  Tests for the Events context and schemas.
  
  Basic functionality tests that don't require database connection.
  """
  
  use ExUnit.Case, async: true
  
  alias EventAPI.Events
  alias EventAPI.Events.{Event, Speaker, Company, Topic, EventSpeaker, EventCompany, EventTopic}
  alias EventAPI.Types.Vector

  describe "Vector type" do
    test "cast/1 accepts list of numbers" do
      assert {:ok, [1.0, 2.0, 3.0]} = Vector.cast([1, 2, 3])
      assert {:ok, [1.5, 2.5, 3.5]} = Vector.cast([1.5, 2.5, 3.5])
    end
    
    test "cast/1 rejects non-numeric lists" do
      assert :error = Vector.cast(["a", "b", "c"])
      assert :error = Vector.cast([1, "a", 3])
    end
    
    test "cast/1 accepts nil" do
      assert {:ok, nil} = Vector.cast(nil)
    end
    
    test "validate_openai_embedding/1 validates dimensions" do
      valid_embedding = List.duplicate(0.1, 1536)
      invalid_embedding = List.duplicate(0.1, 512)
      
      assert {:ok, ^valid_embedding} = Vector.validate_openai_embedding(valid_embedding)
      assert {:error, _} = Vector.validate_openai_embedding(invalid_embedding)
    end
    
    test "cosine_similarity/2 calculates similarity" do
      v1 = [1.0, 0.0, 0.0]
      v2 = [1.0, 0.0, 0.0]
      v3 = [0.0, 1.0, 0.0]
      
      assert 1.0 = Vector.cosine_similarity(v1, v2)
      assert 0.0 = Vector.cosine_similarity(v1, v3)
    end
  end

  describe "Event schema" do
    test "changeset/2 validates required fields" do
      changeset = Event.changeset(%Event{}, %{})
      refute changeset.valid?
      assert "can't be blank" in errors_on(changeset)[:name]
    end
    
    test "changeset/2 validates data quality score range" do
      changeset = Event.changeset(%Event{}, %{name: "Test Event", data_quality_score: 150})
      refute changeset.valid?
      assert "must be an integer between 0 and 100" in errors_on(changeset)[:data_quality_score]
    end
    
    test "calculate_data_quality_score/1 scores event completeness" do
      complete_event = %Event{
        name: "Test Event",
        description: "A test event",
        date: ~D[2024-01-01],
        location: "San Francisco",
        raw_html: "<html>test</html>",
        extracted_data: %{"key" => "value"},
        embedding: List.duplicate(0.1, 1536)
      }
      
      score = Event.calculate_data_quality_score(complete_event)
      assert score == 100
    end
  end

  describe "Speaker schema" do
    test "changeset/2 validates required fields" do
      changeset = Speaker.changeset(%Speaker{}, %{})
      refute changeset.valid?
      assert "can't be blank" in errors_on(changeset)[:name]
    end
    
    test "changeset/2 validates confidence score range" do
      changeset = Speaker.changeset(%Speaker{}, %{name: "John Doe", confidence_score: 1.5})
      refute changeset.valid?
      assert "must be a float between 0.0 and 1.0" in errors_on(changeset)[:confidence_score]
    end
    
    test "normalize_name/1 normalizes speaker names" do
      assert "john smith" = Speaker.normalize_name("Dr. John Smith")
      assert "jane doe" = Speaker.normalize_name("  JANE DOE  ")
      assert "bob jones" = Speaker.normalize_name("Mr. Bob Jones, PhD")
    end
    
    test "name_similarity/2 calculates name similarity" do
      similarity = Speaker.name_similarity("john smith", "john smith")
      assert similarity == 1.0
    end
  end

  describe "Company schema" do
    test "changeset/2 validates required fields" do
      changeset = Company.changeset(%Company{}, %{})
      refute changeset.valid?
      assert "can't be blank" in errors_on(changeset)[:name]
    end
    
    test "normalize_name/1 removes business suffixes" do
      assert "acme" = Company.normalize_name("Acme Inc.")
      assert "tech solutions" = Company.normalize_name("Tech Solutions LLC")
      assert "global systems" = Company.normalize_name("Global Systems Corporation")
    end
    
    test "extract_domain/1 extracts domains from various formats" do
      assert "example.com" = Company.extract_domain("https://example.com/path")
      assert "company.org" = Company.extract_domain("user@company.org")
      assert "test.io" = Company.extract_domain("test.io")
      assert nil = Company.extract_domain("invalid")
    end
  end

  describe "Topic schema" do
    test "changeset/2 validates required fields" do
      changeset = Topic.changeset(%Topic{}, %{})
      refute changeset.valid?
      assert "can't be blank" in errors_on(changeset)[:name]
    end
    
    test "infer_category/1 categorizes topics correctly" do
      assert "technology" = Topic.infer_category("javascript")
      assert "technology" = Topic.infer_category("React Development")
      assert "industry" = Topic.infer_category("fintech")
      assert "format" = Topic.infer_category("workshop")
      assert nil = Topic.infer_category("random topic")
    end
    
    test "extract_topics_from_text/1 finds topics in text" do
      text = "Join us for a JavaScript workshop on React and machine learning in fintech"
      topics = Topic.extract_topics_from_text(text)
      
      assert "javascript" in topics or "js" in topics
      assert "react" in topics
      assert "machine learning" in topics or "ml" in topics
      assert "fintech" in topics
      assert "workshop" in topics
    end
  end

  describe "EventSpeaker schema" do
    test "changeset/2 validates role inclusion" do
      attrs = %{event_id: Ecto.UUID.generate(), speaker_id: Ecto.UUID.generate(), role: "invalid"}
      changeset = EventSpeaker.changeset(%EventSpeaker{}, attrs)
      refute changeset.valid?
      assert "is invalid" in errors_on(changeset)[:role]
    end
    
    test "valid_roles/0 returns valid roles" do
      roles = EventSpeaker.valid_roles()
      assert "speaker" in roles
      assert "judge" in roles
      assert "host" in roles
      assert "panelist" in roles
    end
  end

  describe "EventCompany schema" do
    test "changeset/2 validates relationship type inclusion" do
      attrs = %{event_id: Ecto.UUID.generate(), company_id: Ecto.UUID.generate(), relationship_type: "invalid"}
      changeset = EventCompany.changeset(%EventCompany{}, attrs)
      refute changeset.valid?
      assert "is invalid" in errors_on(changeset)[:relationship_type]
    end
    
    test "valid_relationship_types/0 returns valid types" do
      types = EventCompany.valid_relationship_types()
      assert "host" in types
      assert "sponsor" in types
      assert "venue" in types
      assert "partner" in types
    end
  end

  describe "EventTopic schema" do
    test "changeset/2 validates relevance score range" do
      attrs = %{event_id: Ecto.UUID.generate(), topic_id: Ecto.UUID.generate(), relevance_score: 1.5}
      changeset = EventTopic.changeset(%EventTopic{}, attrs)
      refute changeset.valid?
      assert "must be a float between 0.0 and 1.0" in errors_on(changeset)[:relevance_score]
    end
    
    test "calculate_relevance_score/4 combines scoring factors" do
      event = %Event{name: "Tech Conference"}
      topic = %Topic{name: "javascript", category: "technology"}
      
      score = EventTopic.calculate_relevance_score(event, topic, 0.8, 0.1)
      assert score >= 0.0 and score <= 1.0
      assert score > 0.5  # Should be relatively high due to tech category
    end
  end

  # Helper function to extract changeset errors
  defp errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, opts} ->
      Regex.replace(~r"%{(\w+)}", message, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end