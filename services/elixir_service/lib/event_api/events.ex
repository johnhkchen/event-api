defmodule EventAPI.Events do
  @moduledoc """
  The Events context.
  
  Main public API for all event-related operations including
  vector search, AI processing, and relationship management.
  """

  import Ecto.Query, warn: false
  alias EventAPI.Repo
  alias EventAPI.Types.Vector

  alias EventAPI.Events.{
    Event,
    Speaker,
    Company,
    Topic,
    EventSpeaker,
    EventCompany,
    EventTopic
  }

  ## Event Operations

  @doc """
  Returns the list of events with optional filters.
  """
  def list_events(opts \\ []) do
    query = from(e in Event, order_by: [desc: e.date])

    query = apply_filters(query, opts)

    Repo.all(query)
  end

  @doc """
  Gets a single event.
  """
  def get_event!(id), do: Repo.get!(Event, id)

  @doc """
  Gets a single event, returns tuple format.
  """
  def get_event(id) do
    case Repo.get(Event, id) do
      nil -> {:error, :not_found}
      event -> {:ok, event}
    end
  end

  @doc """
  Gets a single event by luma_url.
  """
  def get_event_by_luma_url(luma_url) do
    Repo.get_by(Event, luma_url: luma_url)
  end

  @doc """
  Creates an event.
  """
  def create_event(attrs \\ %{}) do
    %Event{}
    |> Event.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Creates an event from scraping data.
  """
  def create_scraped_event(attrs) do
    %Event{}
    |> Event.scraping_changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates an event.
  """
  def update_event(%Event{} = event, attrs) do
    event
    |> Event.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Updates an event with AI processing results.
  """
  def update_event_processing(%Event{} = event, attrs) do
    changeset = Event.processing_changeset(event, attrs)
    
    # Calculate data quality score if not provided
    updated_changeset = case Ecto.Changeset.get_field(changeset, :data_quality_score) do
      nil ->
        event_with_changes = Ecto.Changeset.apply_changes(changeset)
        quality_score = Event.calculate_data_quality_score(event_with_changes)
        Ecto.Changeset.put_change(changeset, :data_quality_score, quality_score)
      _ ->
        changeset
    end
    
    Repo.update(updated_changeset)
  end

  @doc """
  Deletes an event.
  """
  def delete_event(%Event{} = event) do
    Repo.delete(event)
  end

  ## Vector Search Operations

  @doc """
  Search events by vector similarity.
  
  Returns events ordered by similarity to the query embedding.
  """
  def search_events_by_similarity(query_embedding, opts \\ []) do
    limit = Keyword.get(opts, :limit, 10)
    min_quality_score = Keyword.get(opts, :min_quality_score, 0)

    query = Event.by_similarity_query(query_embedding, limit)

    query = if min_quality_score > 0 do
      from [e] in query,
        where: e.data_quality_score >= ^min_quality_score
    else
      query
    end

    Repo.all(query)
  end

  @doc """
  Search events by full-text search.
  """
  def search_events_by_text(search_term, opts \\ []) do
    limit = Keyword.get(opts, :limit, 20)

    search_term
    |> Event.by_text_search_query()
    |> limit(^limit)
    |> Repo.all()
  end

  @doc """
  Hybrid search combining vector similarity and text search.
  """
  def hybrid_search(query_embedding, search_term, opts \\ []) do
    vector_weight = Keyword.get(opts, :vector_weight, 0.7)
    text_weight = Keyword.get(opts, :text_weight, 0.3)
    limit = Keyword.get(opts, :limit, 10)

    # Get vector search results
    vector_results = search_events_by_similarity(query_embedding, limit: limit * 2)
    
    # Get text search results  
    text_results = search_events_by_text(search_term, limit: limit * 2)

    # Combine and score results
    combine_search_results(vector_results, text_results, vector_weight, text_weight)
    |> Enum.take(limit)
  end

  ## Speaker Operations

  @doc """
  Returns the list of speakers.
  """
  def list_speakers do
    Repo.all(Speaker)
  end

  @doc """
  Gets a single speaker.
  """
  def get_speaker!(id), do: Repo.get!(Speaker, id)

  @doc """
  Creates a speaker.
  """
  def create_speaker(attrs \\ %{}) do
    %Speaker{}
    |> Speaker.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Find or create speaker with deduplication.
  """
  def find_or_create_speaker(attrs) do
    normalized_name = Speaker.normalize_name(attrs[:name] || "")
    
    case find_similar_speaker(normalized_name) do
      nil ->
        create_speaker(attrs)
      existing_speaker ->
        {:ok, existing_speaker}
    end
  end

  @doc """
  Find similar speakers by normalized name.
  """
  def find_similar_speaker(normalized_name) do
    normalized_name
    |> Speaker.similar_names_query()
    |> limit(1)
    |> Repo.one()
  end

  ## Company Operations

  @doc """
  Returns the list of companies.
  """
  def list_companies do
    Repo.all(Company)
  end

  @doc """
  Gets a single company.
  """
  def get_company!(id), do: Repo.get!(Company, id)

  @doc """
  Creates a company.
  """
  def create_company(attrs \\ %{}) do
    %Company{}
    |> Company.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Find or create company with deduplication.
  """
  def find_or_create_company(attrs) do
    normalized_name = Company.normalize_name(attrs[:name] || "")
    
    case find_company_by_normalized_name(normalized_name) do
      nil ->
        create_company(attrs)
      existing_company ->
        {:ok, existing_company}
    end
  end

  @doc """
  Find company by normalized name or domain.
  """
  def find_company_by_normalized_name(normalized_name) do
    Repo.get_by(Company, normalized_name: normalized_name)
  end

  def find_company_by_domain(domain) when is_binary(domain) do
    domain
    |> Company.by_domain_query()
    |> Repo.one()
  end

  ## Topic Operations

  @doc """
  Returns the list of topics.
  """
  def list_topics do
    Repo.all(Topic)
  end

  @doc """
  Gets a single topic.
  """
  def get_topic!(id), do: Repo.get!(Topic, id)

  @doc """
  Creates a topic.
  """
  def create_topic(attrs \\ %{}) do
    %Topic{}
    |> Topic.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Find or create topic by name.
  """
  def find_or_create_topic(name, category \\ nil) do
    Topic.find_or_create_by_name(name, category)
  end

  @doc """
  Extract and create topics from text.
  """
  def extract_and_create_topics(text) when is_binary(text) do
    text
    |> Topic.extract_topics_from_text()
    |> Enum.map(fn topic_name ->
      case find_or_create_topic(topic_name) do
        {:ok, topic} -> topic
        {:error, _} -> nil
      end
    end)
    |> Enum.filter(&(&1 != nil))
  end

  ## Association Operations

  @doc """
  Associate speaker with event.
  """
  def associate_speaker_with_event(event_id, speaker_id, role, confidence \\ 0.8) do
    EventSpeaker.create_association(event_id, speaker_id, role, confidence)
  end

  @doc """
  Associate company with event.
  """
  def associate_company_with_event(event_id, company_id, relationship_type) do
    EventCompany.create_association(event_id, company_id, relationship_type)
  end

  @doc """
  Associate topic with event.
  """
  def associate_topic_with_event(event_id, topic_id, relevance_score \\ 0.5) do
    EventTopic.create_association(event_id, topic_id, relevance_score)
  end

  @doc """
  Associate multiple topics with an event.
  """
  def associate_topics_with_event(event_id, topic_scores) when is_list(topic_scores) do
    EventTopic.create_associations(event_id, topic_scores)
  end

  ## Query Operations

  @doc """
  Get events for a date range.
  """
  def events_by_date_range(start_date, end_date) do
    start_date
    |> Event.by_date_range_query(end_date)
    |> Repo.all()
  end

  @doc """
  Get high-quality events (above quality threshold).
  """
  def high_quality_events(min_score \\ 70) do
    min_score
    |> Event.by_quality_score_query()
    |> Repo.all()
  end

  @doc """
  Get speakers for an event with their roles.
  """
  def get_event_speakers(event_id) do
    event_id
    |> EventSpeaker.speakers_for_event_query()
    |> Repo.all()
  end

  @doc """
  Get companies for an event with their relationship types.
  """
  def get_event_companies(event_id) do
    event_id
    |> EventCompany.companies_for_event_query()
    |> Repo.all()
  end

  @doc """
  Get topics for an event with relevance scores.
  """
  def get_event_topics(event_id, min_relevance \\ 0.3) do
    event_id
    |> EventTopic.topics_for_event_query(min_relevance)
    |> Repo.all()
  end

  @doc """
  Find similar events based on shared topics.
  """
  def find_similar_events(event_id, min_shared_topics \\ 2, min_relevance \\ 0.5) do
    event_id
    |> EventTopic.similar_events_query(min_shared_topics, min_relevance)
    |> Repo.all()
  end

  @doc """
  Get popular topics across all events.
  """
  def get_popular_topics(limit \\ 20) do
    limit
    |> EventTopic.popular_topics_query()
    |> Repo.all()
  end

  @doc """
  Get trending topics in a date range.
  """
  def get_trending_topics(start_date, end_date, limit \\ 10) do
    start_date
    |> EventTopic.trending_topics_query(end_date, limit)
    |> Repo.all()
  end

  ## Statistics and Analytics

  @doc """
  Get comprehensive event statistics.
  """
  def get_event_statistics do
    total_events = Repo.aggregate(Event, :count, :id)
    processed_events = Repo.aggregate(from(e in Event, where: not is_nil(e.processed_at)), :count, :id)
    avg_quality_score = Repo.aggregate(Event, :avg, :data_quality_score) || 0.0
    
    with_embeddings = Repo.aggregate(from(e in Event, where: not is_nil(e.embedding)), :count, :id)

    %{
      total_events: total_events,
      processed_events: processed_events,
      processing_rate: if(total_events > 0, do: processed_events / total_events * 100, else: 0),
      avg_quality_score: Float.round(avg_quality_score, 2),
      events_with_embeddings: with_embeddings,
      embedding_coverage: if(total_events > 0, do: with_embeddings / total_events * 100, else: 0)
    }
  end

  ## Batch Operations

  @doc """
  Process multiple events with AI results.
  """
  def batch_update_processing(event_results) when is_list(event_results) do
    Repo.transaction(fn ->
      Enum.map(event_results, fn {event_id, processing_data} ->
        case get_event!(event_id) do
          event when is_struct(event) ->
            update_event_processing(event, processing_data)
          nil ->
            {:error, :not_found}
        end
      end)
    end)
  end

  @doc """
  Bulk create event associations (speakers, companies, topics).
  """
  def bulk_create_associations(event_id, associations) do
    Repo.transaction(fn ->
      results = %{
        speakers: create_speaker_associations(event_id, associations[:speakers] || []),
        companies: create_company_associations(event_id, associations[:companies] || []),
        topics: create_topic_associations(event_id, associations[:topics] || [])
      }
      
      results
    end)
  end

  ## Helper Functions

  defp apply_filters(query, opts) do
    Enum.reduce(opts, query, fn
      {:min_quality_score, score}, query ->
        where(query, [e], e.data_quality_score >= ^score)
        
      {:date_range, {start_date, end_date}}, query ->
        where(query, [e], e.date >= ^start_date and e.date <= ^end_date)
        
      {:location, location}, query ->
        where(query, [e], ilike(e.location, ^"%#{location}%"))
        
      {:limit, limit}, query ->
        limit(query, ^limit)
        
      _, query ->
        query
    end)
  end

  defp combine_search_results(vector_results, text_results, vector_weight, text_weight) do
    # Simple scoring combination - in production, use more sophisticated ranking
    vector_scores = Enum.with_index(vector_results) 
                   |> Enum.map(fn {%{event: event}, index} -> 
                        {event.id, vector_weight * (1 - index / length(vector_results))} 
                      end)
                   |> Map.new()

    text_scores = Enum.with_index(text_results)
                 |> Enum.map(fn {event, index} -> 
                      {event.id, text_weight * (1 - index / length(text_results))} 
                    end)
                 |> Map.new()

    # Combine events and scores
    all_event_ids = MapSet.union(MapSet.new(Map.keys(vector_scores)), MapSet.new(Map.keys(text_scores)))
    
    all_event_ids
    |> Enum.map(fn event_id ->
      vector_score = Map.get(vector_scores, event_id, 0)
      text_score = Map.get(text_scores, event_id, 0)
      total_score = vector_score + text_score
      
      event = Enum.find(vector_results ++ text_results, fn
        %{event: e} -> e.id == event_id
        e -> e.id == event_id
      end)
      
      {total_score, event}
    end)
    |> Enum.sort_by(fn {score, _} -> score end, :desc)
    |> Enum.map(fn {_score, event} -> event end)
  end

  defp create_speaker_associations(event_id, speakers) do
    Enum.map(speakers, fn {speaker_id, role, confidence} ->
      EventSpeaker.create_association(event_id, speaker_id, role, confidence)
    end)
  end

  defp create_company_associations(event_id, companies) do
    Enum.map(companies, fn {company_id, relationship_type} ->
      EventCompany.create_association(event_id, company_id, relationship_type)
    end)
  end

  defp create_topic_associations(event_id, topics) do
    EventTopic.create_associations(event_id, topics)
  end
end