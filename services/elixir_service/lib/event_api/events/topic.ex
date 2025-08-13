defmodule EventAPI.Events.Topic do
  @moduledoc """
  Schema for topics table.
  
  Handles event categorization and tagging system with hierarchical
  categories for technology, industry, and format classification.
  """

  use Ecto.Schema
  import Ecto.Changeset
  import Ecto.Query

  alias EventAPI.Events.{Event, EventTopic}

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  # Valid topic categories
  @valid_categories ~w[technology industry format]

  schema "topics" do
    field :name, :string
    field :category, :string
    timestamps(type: :utc_datetime, updated_at: false)

    # Many-to-many associations
    many_to_many :events, Event,
      join_through: EventTopic,
      join_keys: [topic_id: :id, event_id: :id]

    # Junction table association for detailed queries
    has_many :event_topics, EventTopic, foreign_key: :topic_id
  end

  @doc """
  Changeset for creating and updating topics.
  """
  def changeset(topic, attrs) do
    topic
    |> cast(attrs, [:name, :category])
    |> validate_required([:name])
    |> validate_length(:name, min: 1, max: 100)
    |> validate_inclusion(:category, @valid_categories)
    |> validate_non_empty_name()
    |> normalize_name()
    |> unique_constraint(:name)
  end

  @doc """
  Changeset for AI extraction operations.
  """
  def extraction_changeset(topic, attrs) do
    topic
    |> cast(attrs, [:name, :category])
    |> validate_required([:name])
    |> validate_inclusion(:category, @valid_categories)
    |> normalize_name()
    |> unique_constraint(:name)
  end

  # Private validation functions

  defp validate_non_empty_name(changeset) do
    validate_change(changeset, :name, fn field, value ->
      case value do
        name when is_binary(name) ->
          if String.trim(name) == "" do
            [{field, "cannot be empty or whitespace only"}]
          else
            []
          end
        _ -> [{field, "must be a string"}]
      end
    end)
  end

  defp normalize_name(changeset) do
    case get_field(changeset, :name) do
      nil -> changeset
      name when is_binary(name) ->
        normalized = String.trim(name) |> String.downcase()
        put_change(changeset, :name, normalized)
    end
  end

  @doc """
  Get list of valid topic categories.
  """
  def valid_categories, do: @valid_categories

  @doc """
  Infer topic category based on topic name.
  Uses keyword matching to automatically categorize topics.
  """
  def infer_category(topic_name) when is_binary(topic_name) do
    name_lower = String.downcase(topic_name)

    cond do
      technology_topic?(name_lower) -> "technology"
      industry_topic?(name_lower) -> "industry"
      format_topic?(name_lower) -> "format"
      true -> nil
    end
  end

  # Category inference helpers

  defp technology_topic?(name) do
    tech_keywords = [
      # Programming languages
      "javascript", "python", "java", "typescript", "go", "rust", "scala", 
      "kotlin", "swift", "c++", "c#", "php", "ruby", "elixir", "clojure",
      
      # Frameworks and libraries  
      "react", "vue", "angular", "django", "flask", "spring", "node.js",
      "express", "rails", "phoenix", "laravel", "nextjs", "gatsby",
      
      # Technologies and platforms
      "api", "rest", "graphql", "microservices", "docker", "kubernetes",
      "cloud", "aws", "gcp", "azure", "serverless", "blockchain", "ai",
      "machine learning", "ml", "deep learning", "nlp", "computer vision",
      "database", "sql", "nosql", "redis", "mongodb", "postgresql",
      "elasticsearch", "kafka", "redis", "ci/cd", "devops", "infrastructure",
      
      # Development practices
      "agile", "scrum", "tdd", "bdd", "testing", "security", "performance",
      "scalability", "architecture", "design patterns", "clean code",
      "code review", "pair programming", "open source"
    ]
    
    Enum.any?(tech_keywords, &String.contains?(name, &1))
  end

  defp industry_topic?(name) do
    industry_keywords = [
      # Business sectors
      "fintech", "healthcare", "edtech", "e-commerce", "retail", "banking",
      "finance", "insurance", "real estate", "automotive", "manufacturing",
      "logistics", "supply chain", "transportation", "energy", "sustainability",
      "gaming", "entertainment", "media", "advertising", "marketing",
      "legal", "government", "public sector", "non-profit", "social impact",
      
      # Business functions
      "product management", "product", "design", "ux", "ui", "user experience",
      "customer success", "sales", "business development", "hr", "recruiting",
      "operations", "strategy", "consulting", "leadership", "management",
      "entrepreneurship", "startup", "venture capital", "funding", "investment"
    ]
    
    Enum.any?(industry_keywords, &String.contains?(name, &1))
  end

  defp format_topic?(name) do
    format_keywords = [
      # Event formats
      "workshop", "panel", "keynote", "presentation", "demo", "tutorial",
      "hands-on", "lightning talk", "unconference", "hackathon", "bootcamp",
      "masterclass", "webinar", "online", "virtual", "hybrid", "in-person",
      "conference", "meetup", "summit", "symposium", "forum", "roundtable",
      
      # Interaction types
      "networking", "q&a", "discussion", "collaborative", "interactive",
      "beginner", "intermediate", "advanced", "certification", "training"
    ]
    
    Enum.any?(format_keywords, &String.contains?(name, &1))
  end

  @doc """
  Create or find topic by name with automatic category inference.
  """
  def find_or_create_by_name(name, category \\ nil) do
    normalized_name = String.trim(name) |> String.downcase()
    inferred_category = category || infer_category(normalized_name)
    
    attrs = %{name: normalized_name, category: inferred_category}
    
    case EventAPI.Repo.get_by(__MODULE__, name: normalized_name) do
      nil -> 
        %__MODULE__{}
        |> changeset(attrs)
        |> EventAPI.Repo.insert()
      
      existing_topic ->
        {:ok, existing_topic}
    end
  end

  @doc """
  Extract topics from text using keyword matching.
  Returns a list of potential topic names.
  """
  def extract_topics_from_text(text) when is_binary(text) do
    text_lower = String.downcase(text)
    
    # Technology topics
    tech_topics = extract_technology_topics(text_lower)
    
    # Industry topics
    industry_topics = extract_industry_topics(text_lower)
    
    # Format topics
    format_topics = extract_format_topics(text_lower)
    
    (tech_topics ++ industry_topics ++ format_topics)
    |> Enum.uniq()
    |> Enum.map(&String.trim/1)
    |> Enum.filter(&(String.length(&1) > 0))
  end

  defp extract_technology_topics(text) do
    patterns = [
      ~r/\b(javascript|js)\b/,
      ~r/\b(python|py)\b/,
      ~r/\b(machine learning|ml|ai|artificial intelligence)\b/,
      ~r/\b(react|vue|angular)\b/,
      ~r/\b(docker|kubernetes|k8s)\b/,
      ~r/\b(aws|azure|gcp|google cloud|cloud computing)\b/,
      ~r/\b(api|rest api|graphql)\b/,
      ~r/\b(blockchain|cryptocurrency|crypto)\b/,
      ~r/\b(devops|ci\/cd|continuous integration)\b/,
      ~r/\b(microservices|serverless)\b/
    ]
    
    extract_by_patterns(text, patterns)
  end

  defp extract_industry_topics(text) do
    patterns = [
      ~r/\b(fintech|financial technology)\b/,
      ~r/\b(healthcare|health tech|medical)\b/,
      ~r/\b(e-commerce|ecommerce|retail)\b/,
      ~r/\b(startup|entrepreneurship)\b/,
      ~r/\b(product management|product)\b/,
      ~r/\b(ux|user experience|ui|user interface|design)\b/,
      ~r/\b(marketing|advertising|growth)\b/,
      ~r/\b(sales|business development)\b/
    ]
    
    extract_by_patterns(text, patterns)
  end

  defp extract_format_topics(text) do
    patterns = [
      ~r/\b(workshop|hands.on)\b/,
      ~r/\b(panel|discussion)\b/,
      ~r/\b(networking|meetup)\b/,
      ~r/\b(hackathon|hack)\b/,
      ~r/\b(demo|demonstration)\b/,
      ~r/\b(tutorial|training)\b/,
      ~r/\b(beginner|intermediate|advanced)\b/
    ]
    
    extract_by_patterns(text, patterns)
  end

  defp extract_by_patterns(text, patterns) do
    Enum.flat_map(patterns, fn pattern ->
      case Regex.scan(pattern, text) do
        [] -> []
        matches -> Enum.map(matches, fn [match | _] -> match end)
      end
    end)
  end

  @doc """
  Query helper to find topics by category.
  """
  def by_category_query(category) when category in @valid_categories do
    from t in __MODULE__,
      where: t.category == ^category,
      order_by: t.name
  end

  @doc """
  Query helper to search topics by name.
  """
  def search_by_name_query(search_term) when is_binary(search_term) do
    pattern = "%#{search_term}%"
    
    from t in __MODULE__,
      where: ilike(t.name, ^pattern),
      order_by: t.name
  end

  @doc """
  Query helper to get popular topics (by event count).
  """
  def popular_topics_query(limit \\ 20) do
    from t in __MODULE__,
      left_join: et in assoc(t, :event_topics),
      group_by: t.id,
      order_by: [desc: count(et.event_id)],
      limit: ^limit,
      select: {t, count(et.event_id)}
  end

  @doc """
  Query helper to get topics for a specific time period.
  """
  def trending_topics_query(start_date, end_date, limit \\ 10) do
    from t in __MODULE__,
      join: et in assoc(t, :event_topics),
      join: e in assoc(et, :event),
      where: e.date >= ^start_date and e.date <= ^end_date,
      group_by: t.id,
      order_by: [desc: count(et.event_id)],
      limit: ^limit,
      select: {t, count(et.event_id)}
  end
end