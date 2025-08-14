defmodule EventAPIWeb.Internal.RecommendationController do
  @moduledoc """
  Controller for recommendation engine endpoints.
  
  These endpoints provide AI-powered recommendations for events and speakers
  using vector similarity, topic matching, and collaborative filtering.
  """
  
  use EventAPIWeb, :controller
  require Logger
  
  alias EventAPI.Processing.RecommendationEngine
  
  action_fallback EventAPIWeb.FallbackController

  @doc """
  Generate event recommendations based on user profile.
  
  ## Parameters
  - interests: List of user interests/topics
  - location: Preferred location (optional)
  - experience_level: User's experience level (optional)
  - preferred_formats: Preferred event formats (optional)
  
  ## Response
  Returns personalized event recommendations with relevance scores.
  """
  def events(conn, user_profile) do
    Logger.info("Processing event recommendations for user profile")
    
    case RecommendationEngine.recommend_events(user_profile) do
      {:ok, result} ->
        conn
        |> put_status(:ok)
        |> json(%{
          success: true,
          data: result
        })
        
      {:error, reason} ->
        Logger.error("Event recommendation failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Find events similar to a given event.
  
  ## Parameters
  - event_id: The ID of the source event to find similar events for
  
  ## Response
  Returns a list of similar events with similarity scores and explanations.
  """
  def similar(conn, %{"event_id" => event_id}) do
    Logger.info("Finding similar events for event ID: #{event_id}")
    
    case RecommendationEngine.find_similar_events(event_id) do
      {:ok, result} ->
        conn
        |> put_status(:ok)
        |> json(%{
          success: true,
          data: result
        })
        
      {:error, reason} ->
        Logger.error("Similar events search failed for ID '#{event_id}': #{inspect(reason)}")
        {:error, reason}
    end
  end

  @doc """
  Generate speaker recommendations based on speaker profile.
  
  ## Parameters
  - speaker_id: The ID of the source speaker to find recommendations for
  
  ## Response
  Returns recommended speakers with relevance scores and connection explanations.
  """
  def speakers(conn, %{"speaker_id" => speaker_id}) do
    Logger.info("Processing speaker recommendations for speaker ID: #{speaker_id}")
    
    case RecommendationEngine.recommend_speakers(speaker_id) do
      {:ok, result} ->
        conn
        |> put_status(:ok)
        |> json(%{
          success: true,
          data: result
        })
        
      {:error, reason} ->
        Logger.error("Speaker recommendation failed for ID '#{speaker_id}': #{inspect(reason)}")
        {:error, reason}
    end
  end
end