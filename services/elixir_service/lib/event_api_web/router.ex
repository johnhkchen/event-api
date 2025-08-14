defmodule EventAPIWeb.Router do
  use EventAPIWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {EventAPIWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", EventAPIWeb do
    pipe_through :browser

    get "/", PageController, :home
  end

  # Health check endpoints (no authentication required)
  scope "/health", EventAPIWeb do
    pipe_through :api
    
    get "/liveness", HealthController, :liveness
    get "/readiness", HealthController, :readiness
    get "/", HealthController, :health
  end

  # Internal API endpoints
  scope "/internal", EventAPIWeb do
    pipe_through :api
    
    # Event processing endpoints
    post "/process", ProcessingController, :process
    post "/process/batch", ProcessingController, :process_batch
    get "/processing/status", ProcessingController, :status
    get "/processing/health", ProcessingController, :health
    post "/processing/circuit-breaker/reset", ProcessingController, :reset_circuit_breaker
    
    # Graph relationship endpoints
    get "/graph/:query", Internal.GraphController, :query
    get "/graph/speaker/:speaker_id", Internal.GraphController, :speaker
    
    # Entity deduplication endpoints
    post "/deduplicate", Internal.DeduplicationController, :deduplicate
    
    # Recommendation engine endpoints
    post "/recommend/events", Internal.RecommendationController, :events
    get "/recommend/similar/:event_id", Internal.RecommendationController, :similar
    get "/recommend/speakers/:speaker_id", Internal.RecommendationController, :speakers
  end

  # Enable LiveDashboard and Swoosh mailbox preview in development
  if Application.compile_env(:event_api, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: EventAPIWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end
