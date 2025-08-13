defmodule EventAPI.Processing.Supervisor do
  @moduledoc """
  Supervisor for event processing services and workers.
  
  This module manages the supervision tree for:
  - Event processing workers
  - AI content extraction workers  
  - Deduplication services
  - Graph relationship workers
  - Recommendation engine workers
  """
  
  use Supervisor

  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  @impl true
  def init(_init_arg) do
    children = [
      # Event processing workers
      {DynamicSupervisor, strategy: :one_for_one, name: EventAPI.Processing.WorkerSupervisor},
      
      # Pipeline orchestrator (manages the entire processing flow)
      EventAPI.Processing.PipelineOrchestrator,
      
      # Content extraction service
      EventAPI.Processing.ContentExtractor,
      
      # Deduplication service
      EventAPI.Processing.DeduplicationService,
      
      # Graph relationship service
      EventAPI.Processing.GraphService,
      
      # Recommendation engine
      EventAPI.Processing.RecommendationEngine
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end