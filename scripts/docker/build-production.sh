#!/bin/bash
# Build production container using Flox containerization

set -e

echo "🔨 Building production container with Flox..."

# Ensure we're in the repo root
cd "$(dirname "$0")/../.."

# Get current git commit for tagging  
COMMIT_SHA=$(git rev-parse --short HEAD)
IMAGE_TAG="${COMMIT_SHA}"

echo "📦 Building container with tag: ${IMAGE_TAG}"

# Build using Flox containerization directly to Docker
if flox containerize --tag "${IMAGE_TAG}" --runtime docker; then
    echo "✅ Container built successfully!"
    echo "   Image: event-api:${IMAGE_TAG}"
    echo "   Available in Docker runtime"
    echo ""
    echo "🚀 To run:"
    echo "   docker run --rm event-api:${IMAGE_TAG} -c 'echo \"Container ready!\"'"
    echo "   docker run -d --name event-api -p 3000:3000 -p 4000:4000 event-api:${IMAGE_TAG}"
else
    echo "❌ Container build failed!"
    exit 1
fi

echo ""
echo "📋 Container info:"
docker images | grep event-api || echo "Image not found in Docker"

# Create backup tar file for archival/deployment
echo ""
echo "💾 Creating backup tar file..."
flox containerize --tag "${IMAGE_TAG}" --file "event-api-${IMAGE_TAG}.tar"
echo "   Backup file: event-api-${IMAGE_TAG}.tar"