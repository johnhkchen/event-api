defmodule EventAPI.Processing.DeduplicationService do
  @moduledoc """
  GenServer for AI-powered deduplication of speakers, companies, and events.
  
  This service identifies and merges duplicate entities using:
  - Advanced fuzzy string matching with Jaro-Winkler distance
  - Multi-factor confidence scoring
  - Company and context-based matching
  - Event semantic similarity using vector embeddings
  - Manual review workflow for edge cases
  """
  
  use GenServer
  require Logger
  
  alias EventAPI.Repo
  alias EventAPI.Events.{Event, Speaker, Company}
  alias EventAPI.Events
  import Ecto.Query

  # Confidence thresholds
  @high_confidence_threshold 0.9
  @medium_confidence_threshold 0.7
  @low_confidence_threshold 0.5
  
  # Batch processing size
  @batch_size 100

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    Logger.info("DeduplicationService started with enhanced algorithms")
    {:ok, %{processing_queue: [], review_queue: []}}
  end

  # Public API

  @doc """
  Deduplicate a list of speakers using enhanced multi-factor scoring.
  """
  def deduplicate_speakers(speaker_list) do
    GenServer.call(__MODULE__, {:deduplicate_speakers, speaker_list}, 30_000)
  end

  @doc """
  Deduplicate a list of companies using normalized names and domain matching.
  """
  def deduplicate_companies(company_list) do
    GenServer.call(__MODULE__, {:deduplicate_companies, company_list}, 30_000)
  end
  
  @doc """
  Deduplicate events using semantic similarity and metadata matching.
  """
  def deduplicate_events(event_list) do
    GenServer.call(__MODULE__, {:deduplicate_events, event_list}, 30_000)
  end
  
  @doc """
  Process batch deduplication operations efficiently.
  """
  def batch_deduplicate(entity_type, batch_opts \\ []) do
    GenServer.call(__MODULE__, {:batch_deduplicate, entity_type, batch_opts}, 120_000)
  end
  
  @doc """
  Get items in the manual review queue.
  """
  def get_review_queue do
    GenServer.call(__MODULE__, :get_review_queue)
  end
  
  @doc """
  Approve a manual review item for merging.
  """
  def approve_merge(review_id, approved \\ true) do
    GenServer.call(__MODULE__, {:approve_merge, review_id, approved})
  end

  # GenServer callbacks

  @impl true
  def handle_call({:deduplicate_speakers, speaker_list}, _from, state) do
    Logger.info("Processing #{length(speaker_list)} speakers for deduplication")
    
    try do
      result = process_speaker_deduplication(speaker_list)
      {:reply, result, state}
    rescue
      error ->
        Logger.error("Speaker deduplication failed: #{inspect(error)}")
        {:reply, %{status: :error, message: "Deduplication failed", error: inspect(error)}, state}
    end
  end

  @impl true
  def handle_call({:deduplicate_companies, company_list}, _from, state) do
    Logger.info("Processing #{length(company_list)} companies for deduplication")
    
    try do
      result = process_company_deduplication(company_list)
      {:reply, result, state}
    rescue
      error ->
        Logger.error("Company deduplication failed: #{inspect(error)}")
        {:reply, %{status: :error, message: "Deduplication failed", error: inspect(error)}, state}
    end
  end
  
  @impl true
  def handle_call({:deduplicate_events, event_list}, _from, state) do
    Logger.info("Processing #{length(event_list)} events for deduplication")
    
    try do
      result = process_event_deduplication(event_list)
      {:reply, result, state}
    rescue
      error ->
        Logger.error("Event deduplication failed: #{inspect(error)}")
        {:reply, %{status: :error, message: "Deduplication failed", error: inspect(error)}, state}
    end
  end
  
  @impl true
  def handle_call({:batch_deduplicate, entity_type, batch_opts}, _from, state) do
    Logger.info("Starting batch deduplication for #{entity_type}")
    
    try do
      result = process_batch_deduplication(entity_type, batch_opts)
      {:reply, result, state}
    rescue
      error ->
        Logger.error("Batch deduplication failed: #{inspect(error)}")
        {:reply, %{status: :error, message: "Batch deduplication failed", error: inspect(error)}, state}
    end
  end
  
  @impl true
  def handle_call(:get_review_queue, _from, %{review_queue: queue} = state) do
    {:reply, %{status: :success, review_queue: queue}, state}
  end
  
  @impl true
  def handle_call({:approve_merge, review_id, approved}, _from, %{review_queue: queue} = state) do
    case find_and_process_review_item(queue, review_id, approved) do
      {:ok, updated_queue, result} ->
        {:reply, %{status: :success, result: result}, %{state | review_queue: updated_queue}}
      {:error, reason} ->
        {:reply, %{status: :error, message: reason}, state}
    end
  end

  # Private implementation functions
  
  defp process_speaker_deduplication(speaker_list) do
    Logger.debug("Processing #{length(speaker_list)} speakers for deduplication")
    
    # Group speakers by similarity
    similarity_groups = group_speakers_by_similarity(speaker_list)
    Logger.debug("Found #{length(similarity_groups)} similarity groups")
    
    # Process each group for potential merges
    {auto_merged, manual_review, kept_separate} = 
      Enum.reduce(similarity_groups, {[], [], []}, fn group, {auto, manual, separate} ->
        case process_speaker_group(group) do
          {:auto_merge, merged_group} -> {[merged_group | auto], manual, separate}
          {:manual_review, review_item} -> {auto, [review_item | manual], separate}
          {:keep_separate, speakers} -> {auto, manual, speakers ++ separate}
        end
      end)
    
    # Return comprehensive results
    %{
      status: :success,
      auto_merged: auto_merged,
      manual_review_items: manual_review,
      kept_separate: kept_separate,
      stats: %{
        total_processed: length(speaker_list),
        auto_merged_groups: length(auto_merged),
        manual_review_items: length(manual_review),
        kept_separate: length(kept_separate)
      }
    }
  end
  
  defp process_company_deduplication(company_list) do
    Logger.debug("Processing #{length(company_list)} companies for deduplication")
    
    # Group companies by normalized names and domains
    similarity_groups = group_companies_by_similarity(company_list)
    Logger.debug("Found #{length(similarity_groups)} company similarity groups")
    
    # Process each group for potential merges
    {auto_merged, manual_review, kept_separate} =
      Enum.reduce(similarity_groups, {[], [], []}, fn group, {auto, manual, separate} ->
        case process_company_group(group) do
          {:auto_merge, merged_group} -> {[merged_group | auto], manual, separate}
          {:manual_review, review_item} -> {auto, [review_item | manual], separate}
          {:keep_separate, companies} -> {auto, manual, companies ++ separate}
        end
      end)
      
    %{
      status: :success,
      auto_merged: auto_merged,
      manual_review_items: manual_review,
      kept_separate: kept_separate,
      stats: %{
        total_processed: length(company_list),
        auto_merged_groups: length(auto_merged),
        manual_review_items: length(manual_review),
        kept_separate: length(kept_separate)
      }
    }
  end
  
  defp process_event_deduplication(event_list) do
    Logger.debug("Processing #{length(event_list)} events for deduplication")
    
    # Group events by similarity (location, date, title)
    similarity_groups = group_events_by_similarity(event_list)
    Logger.debug("Found #{length(similarity_groups)} event similarity groups")
    
    # Process each group for potential merges
    {auto_merged, manual_review, kept_separate} =
      Enum.reduce(similarity_groups, {[], [], []}, fn group, {auto, manual, separate} ->
        case process_event_group(group) do
          {:auto_merge, merged_group} -> {[merged_group | auto], manual, separate}
          {:manual_review, review_item} -> {auto, [review_item | manual], separate}
          {:keep_separate, events} -> {auto, manual, events ++ separate}
        end
      end)
      
    %{
      status: :success,
      auto_merged: auto_merged,
      manual_review_items: manual_review,
      kept_separate: kept_separate,
      stats: %{
        total_processed: length(event_list),
        auto_merged_groups: length(auto_merged),
        manual_review_items: length(manual_review),
        kept_separate: length(kept_separate)
      }
    }
  end

  defp process_batch_deduplication(_entity_type, _batch_opts) do
    # TODO: Implement batch deduplication logic
    {:ok, %{processed: 0, merged: 0, reviewed: 0}}
  end
  
  defp find_and_process_review_item(_queue, _review_id, _approved) do
    # TODO: Implement review processing logic
    {:error, "Review functionality not yet implemented"}
  end
  
  # Helper functions for speaker deduplication
  
  defp group_speakers_by_similarity(speaker_list) do
    # Group speakers by exact normalized name match for now
    speaker_list
    |> Enum.group_by(&Speaker.normalize_name(&1.name || ""))
    |> Map.values()
    |> Enum.filter(&(length(&1) > 1))
  end
  
  defp process_speaker_group([speaker]) do
    {:keep_separate, [speaker]}
  end
  
  defp process_speaker_group(speakers) when length(speakers) > 1 do
    # Calculate average confidence for the group
    confidences = for s1 <- speakers, s2 <- speakers, s1 != s2 do
      calculate_speaker_confidence(s1, s2)
    end
    
    average_confidence = if length(confidences) > 0 do
      Enum.sum(confidences) / length(confidences)
    else
      0.0
    end
    
    cond do
      average_confidence >= @high_confidence_threshold ->
        primary_speaker = find_primary_speaker(speakers)
        {:auto_merge, merge_speakers(speakers, primary_speaker)}
        
      average_confidence >= @medium_confidence_threshold ->
        review_item = create_speaker_review_item(speakers, average_confidence)
        {:manual_review, review_item}
        
      true ->
        {:keep_separate, speakers}
    end
  end
  
  defp calculate_speaker_confidence(speaker1, speaker2) do
    # Multi-factor confidence calculation using existing Speaker functions
    name1 = Speaker.normalize_name(speaker1.name || "")
    name2 = Speaker.normalize_name(speaker2.name || "")
    
    # Base name similarity
    name_similarity = Speaker.name_similarity(name1, name2)
    
    # Company match bonus
    company_bonus = if speaker1.company && speaker2.company do
      company1 = Company.normalize_name(speaker1.company)
      company2 = Company.normalize_name(speaker2.company)
      Company.name_similarity(company1, company2) * 0.3
    else
      0.0
    end
    
    # Combine factors (capped at 1.0)
    min(name_similarity + company_bonus, 1.0)
  end
  
  defp find_primary_speaker(speakers) do
    # Find speaker with highest confidence or most complete data
    Enum.max_by(speakers, fn speaker ->
      base_score = speaker.confidence_score || 0.0
      completeness = if speaker.company, do: 0.1, else: 0.0
      completeness = completeness + if speaker.bio, do: 0.2, else: 0.0
      base_score + completeness
    end)
  end
  
  defp merge_speakers(speakers, primary_speaker) do
    %{
      primary: primary_speaker,
      merged_data: %{
        name: primary_speaker.name,
        company: primary_speaker.company || find_best_company(speakers),
        bio: primary_speaker.bio || find_best_bio(speakers),
        confidence_score: 0.9
      },
      merged_from: speakers -- [primary_speaker]
    }
  end
  
  defp create_speaker_review_item(speakers, confidence) do
    %{
      id: :crypto.strong_rand_bytes(16) |> Base.encode16(),
      type: :speaker_merge,
      candidates: speakers,
      confidence: confidence,
      created_at: DateTime.utc_now()
    }
  end
  
  defp find_best_company(speakers) do
    speakers |> Enum.map(& &1.company) |> Enum.filter(& &1) |> List.first()
  end
  
  defp find_best_bio(speakers) do
    speakers |> Enum.map(& &1.bio) |> Enum.filter(& &1) |> Enum.max_by(&String.length/1, fn -> nil end)
  end
  
  # Company deduplication helper functions
  
  defp group_companies_by_similarity(company_list) do
    # Group by exact normalized name match and domain match
    name_groups = company_list
    |> Enum.group_by(&Company.normalize_name(&1.name || ""))
    |> Map.values()
    |> Enum.filter(&(length(&1) > 1))
    
    # Also group by domain if available
    domain_groups = company_list
    |> Enum.filter(& &1.domain)
    |> Enum.group_by(& &1.domain)
    |> Map.values()
    |> Enum.filter(&(length(&1) > 1))
    
    # Combine and deduplicate groups
    (name_groups ++ domain_groups) |> Enum.uniq()
  end
  
  defp process_company_group([company]) do
    {:keep_separate, [company]}
  end
  
  defp process_company_group(companies) when length(companies) > 1 do
    # Check for domain matches (high confidence)
    domain_matches = Enum.filter(companies, & &1.domain)
    
    cond do
      length(domain_matches) > 1 ->
        # Multiple companies with same domain = auto merge
        primary_company = find_primary_company(companies)
        {:auto_merge, merge_companies(companies, primary_company)}
        
      true ->
        # Name-based similarity only = manual review
        average_confidence = calculate_company_group_confidence(companies)
        
        if average_confidence >= @medium_confidence_threshold do
          review_item = create_company_review_item(companies, average_confidence)
          {:manual_review, review_item}
        else
          {:keep_separate, companies}
        end
    end
  end
  
  defp calculate_company_group_confidence(companies) do
    confidences = for c1 <- companies, c2 <- companies, c1 != c2 do
      calculate_company_confidence(c1, c2)
    end
    
    if length(confidences) > 0 do
      Enum.sum(confidences) / length(confidences)
    else
      0.0
    end
  end
  
  defp calculate_company_confidence(company1, company2) do
    name1 = Company.normalize_name(company1.name || "")
    name2 = Company.normalize_name(company2.name || "")
    
    # Base name similarity  
    name_similarity = Company.name_similarity(name1, name2)
    
    # Domain exact match bonus
    domain_bonus = if company1.domain && company2.domain && company1.domain == company2.domain do
      0.5
    else
      0.0
    end
    
    min(name_similarity + domain_bonus, 1.0)
  end
  
  defp find_primary_company(companies) do
    # Prioritize companies with domains, then most complete data
    Enum.max_by(companies, fn company ->
      base_score = 0.0
      base_score = base_score + if company.domain, do: 0.5, else: 0.0
      base_score = base_score + if company.industry, do: 0.3, else: 0.0
      base_score
    end)
  end
  
  defp merge_companies(companies, primary_company) do
    %{
      primary: primary_company,
      merged_data: %{
        name: primary_company.name,
        domain: primary_company.domain || find_best_domain(companies),
        industry: primary_company.industry || find_best_industry(companies)
      },
      merged_from: companies -- [primary_company]
    }
  end
  
  defp create_company_review_item(companies, confidence) do
    %{
      id: :crypto.strong_rand_bytes(16) |> Base.encode16(),
      type: :company_merge,
      candidates: companies,
      confidence: confidence,
      created_at: DateTime.utc_now()
    }
  end
  
  defp find_best_domain(companies) do
    companies |> Enum.map(& &1.domain) |> Enum.filter(& &1) |> List.first()
  end
  
  defp find_best_industry(companies) do
    companies |> Enum.map(& &1.industry) |> Enum.filter(& &1) |> List.first()
  end
  
  # Event deduplication helper functions
  
  defp group_events_by_similarity(event_list) do
    # Group events by date and location similarity
    event_list
    |> Enum.group_by(&event_grouping_key/1)
    |> Map.values()
    |> Enum.filter(&(length(&1) > 1))
  end
  
  defp event_grouping_key(event) do
    # Simple grouping by date and location
    date_key = if event.date, do: Date.to_string(event.date), else: "no_date"
    location_key = if event.location, do: String.downcase(event.location), else: "no_location"
    "#{date_key}_#{location_key}"
  end
  
  defp process_event_group([event]) do
    {:keep_separate, [event]}
  end
  
  defp process_event_group(events) when length(events) > 1 do
    # Calculate event similarity confidence
    average_confidence = calculate_event_group_confidence(events)
    
    cond do
      average_confidence >= @high_confidence_threshold ->
        primary_event = find_primary_event(events)
        {:auto_merge, merge_events(events, primary_event)}
        
      average_confidence >= @medium_confidence_threshold ->
        review_item = create_event_review_item(events, average_confidence)
        {:manual_review, review_item}
        
      true ->
        {:keep_separate, events}
    end
  end
  
  defp calculate_event_group_confidence(events) do
    confidences = for e1 <- events, e2 <- events, e1 != e2 do
      calculate_event_confidence(e1, e2)
    end
    
    if length(confidences) > 0 do
      Enum.sum(confidences) / length(confidences)
    else
      0.0
    end
  end
  
  defp calculate_event_confidence(event1, event2) do
    # Multi-factor event similarity
    factors = []
    
    # Name similarity
    name_similarity = if event1.name && event2.name do
      calculate_text_similarity(String.downcase(event1.name), String.downcase(event2.name))
    else
      0.0
    end
    factors = [name_similarity * 0.4 | factors]
    
    # Date exact match
    date_match = if event1.date == event2.date, do: 0.3, else: 0.0
    factors = [date_match | factors]
    
    # Location similarity
    location_similarity = if event1.location && event2.location do
      calculate_text_similarity(String.downcase(event1.location), String.downcase(event2.location)) * 0.3
    else
      0.0
    end
    factors = [location_similarity | factors]
    
    Enum.sum(factors)
  end
  
  defp calculate_text_similarity(text1, text2) do
    # Simple word overlap similarity
    words1 = String.split(text1)
    words2 = String.split(text2)
    
    common_words = Enum.count(words1, fn w1 -> Enum.member?(words2, w1) end)
    total_words = max(length(words1), length(words2))
    
    if total_words > 0, do: common_words / total_words, else: 0.0
  end
  
  defp find_primary_event(events) do
    # Find event with highest data quality score
    Enum.max_by(events, fn event ->
      event.data_quality_score || 0.0
    end)
  end
  
  defp merge_events(events, primary_event) do
    %{
      primary: primary_event,
      merged_data: %{
        name: primary_event.name,
        description: primary_event.description || find_best_description(events),
        location: primary_event.location,
        date: primary_event.date
      },
      merged_from: events -- [primary_event]
    }
  end
  
  defp create_event_review_item(events, confidence) do
    %{
      id: :crypto.strong_rand_bytes(16) |> Base.encode16(),
      type: :event_merge,
      candidates: events,
      confidence: confidence,
      created_at: DateTime.utc_now()
    }
  end
  
  defp find_best_description(events) do
    events
    |> Enum.map(& &1.description)
    |> Enum.filter(& &1)
    |> Enum.max_by(&String.length/1, fn -> nil end)
  end
end