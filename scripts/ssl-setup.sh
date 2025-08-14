#!/bin/bash

# Event API - SSL Setup Script for Coolify Deployment
# Automated SSL/TLS certificate setup with Let's Encrypt
# This script handles domain validation and certificate provisioning

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="${PROJECT_ROOT}/logs/ssl-setup.log"

# Create logs directory
mkdir -p "${PROJECT_ROOT}/logs"

# Logging function
log() {
    local level="$1"
    shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*" | tee -a "$LOG_FILE"
}

# Color output functions
info() { echo -e "\033[36m[INFO]\033[0m $*" | tee -a "$LOG_FILE"; }
success() { echo -e "\033[32m[SUCCESS]\033[0m $*" | tee -a "$LOG_FILE"; }
warning() { echo -e "\033[33m[WARNING]\033[0m $*" | tee -a "$LOG_FILE"; }
error() { echo -e "\033[31m[ERROR]\033[0m $*" | tee -a "$LOG_FILE"; }

# Configuration from environment or defaults
DOMAIN="${DOMAIN:-api.localhost}"
ADMIN_DOMAIN="${ADMIN_DOMAIN:-admin.localhost}"
ML_DOMAIN="${ML_DOMAIN:-ml.localhost}"
SSL_EMAIL="${SSL_EMAIL:-admin@localhost}"
CERTBOT_STAGING="${CERTBOT_STAGING:-false}"

# Coolify-specific paths
NGINX_CONF_DIR="/etc/nginx/sites-available"
NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"
LETSENCRYPT_DIR="/etc/letsencrypt"
WEBROOT_DIR="/var/www/certbot"

# Print configuration
print_config() {
    info "SSL Setup Configuration:"
    info "  Primary Domain: $DOMAIN"
    info "  Admin Domain: $ADMIN_DOMAIN"
    info "  ML Domain: $ML_DOMAIN"
    info "  SSL Email: $SSL_EMAIL"
    info "  Staging Mode: $CERTBOT_STAGING"
    info "  Log File: $LOG_FILE"
    echo
}

# Check prerequisites
check_prerequisites() {
    info "Checking prerequisites..."
    
    local missing_deps=()
    
    # Check required commands
    for cmd in nginx certbot dig curl; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            missing_deps+=("$cmd")
        fi
    done
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        error "Missing required dependencies: ${missing_deps[*]}"
        error "Please install missing dependencies and retry"
        exit 1
    fi
    
    # Check if running as root or with sudo
    if [ "$EUID" -ne 0 ]; then
        error "This script must be run as root or with sudo"
        exit 1
    fi
    
    success "Prerequisites check passed"
}

# Validate domain DNS configuration
validate_domain_dns() {
    local domain="$1"
    info "Validating DNS configuration for $domain..."
    
    # Get the IP address the domain resolves to
    local resolved_ip
    if ! resolved_ip=$(dig +short "$domain" A | head -n1); then
        warning "Could not resolve $domain"
        return 1
    fi
    
    if [ -z "$resolved_ip" ]; then
        warning "$domain does not resolve to any IP address"
        return 1
    fi
    
    # Get the server's public IP
    local server_ip
    if ! server_ip=$(curl -s ifconfig.me || curl -s ipinfo.io/ip || curl -s icanhazip.com); then
        warning "Could not determine server's public IP"
        return 1
    fi
    
    if [ "$resolved_ip" != "$server_ip" ]; then
        warning "$domain resolves to $resolved_ip but server IP is $server_ip"
        warning "DNS propagation may not be complete"
        return 1
    fi
    
    success "$domain correctly resolves to $server_ip"
    return 0
}

# Setup nginx configuration for ACME challenge
setup_nginx_acme() {
    info "Setting up Nginx configuration for ACME challenge..."
    
    # Create webroot directory
    mkdir -p "$WEBROOT_DIR"
    chown -R nginx:nginx "$WEBROOT_DIR" 2>/dev/null || chown -R www-data:www-data "$WEBROOT_DIR"
    
    # Create temporary nginx config for ACME challenge
    local temp_config="/tmp/acme-challenge.conf"
    cat > "$temp_config" << EOF
server {
    listen 80;
    server_name ${DOMAIN} ${ADMIN_DOMAIN} ${ML_DOMAIN};
    
    location /.well-known/acme-challenge/ {
        root ${WEBROOT_DIR};
        try_files \$uri \$uri/ =404;
    }
    
    location / {
        return 301 https://\$host\$request_uri;
    }
}
EOF
    
    # Install the configuration
    cp "$temp_config" "$NGINX_CONF_DIR/acme-challenge"
    ln -sf "$NGINX_CONF_DIR/acme-challenge" "$NGINX_ENABLED_DIR/acme-challenge"
    
    # Test and reload nginx
    if nginx -t; then
        systemctl reload nginx
        success "Nginx configuration for ACME challenge installed"
    else
        error "Nginx configuration test failed"
        return 1
    fi
    
    rm -f "$temp_config"
}

# Obtain SSL certificates with certbot
obtain_certificates() {
    info "Obtaining SSL certificates with Let's Encrypt..."
    
    # Prepare certbot command
    local certbot_cmd="certbot certonly --webroot"
    certbot_cmd+=" --webroot-path=$WEBROOT_DIR"
    certbot_cmd+=" --email $SSL_EMAIL"
    certbot_cmd+=" --agree-tos"
    certbot_cmd+=" --no-eff-email"
    
    # Add staging flag if requested
    if [ "$CERTBOT_STAGING" = "true" ]; then
        certbot_cmd+=" --staging"
        warning "Using Let's Encrypt staging environment"
    fi
    
    # Request certificates for all domains
    certbot_cmd+=" -d $DOMAIN -d $ADMIN_DOMAIN -d $ML_DOMAIN"
    
    info "Running certbot: $certbot_cmd"
    
    # Execute certbot
    if $certbot_cmd; then
        success "SSL certificates obtained successfully"
    else
        error "Failed to obtain SSL certificates"
        error "Check the certbot logs for details: /var/log/letsencrypt/letsencrypt.log"
        return 1
    fi
}

# Install production nginx configuration
install_production_config() {
    info "Installing production Nginx configuration..."
    
    # Copy the production nginx config
    local prod_config="${PROJECT_ROOT}/config/nginx.conf"
    if [ ! -f "$prod_config" ]; then
        error "Production nginx configuration not found at $prod_config"
        return 1
    fi
    
    # Substitute environment variables in the configuration
    envsubst '${DOMAIN}' < "$prod_config" > "/etc/nginx/nginx.conf"
    
    # Remove the temporary ACME challenge config
    rm -f "$NGINX_ENABLED_DIR/acme-challenge"
    rm -f "$NGINX_CONF_DIR/acme-challenge"
    
    # Test the configuration
    if nginx -t; then
        systemctl reload nginx
        success "Production Nginx configuration installed"
    else
        error "Production Nginx configuration test failed"
        return 1
    fi
}

# Verify SSL certificates
verify_certificates() {
    info "Verifying SSL certificates..."
    
    local domains=("$DOMAIN" "$ADMIN_DOMAIN" "$ML_DOMAIN")
    
    for domain in "${domains[@]}"; do
        info "Checking certificate for $domain..."
        
        # Test HTTPS connection
        if curl -I -s --max-time 10 "https://$domain/" > /dev/null 2>&1; then
            success "HTTPS connection successful for $domain"
            
            # Get certificate information
            local cert_info
            cert_info=$(echo | openssl s_client -servername "$domain" -connect "$domain:443" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null)
            
            if [ -n "$cert_info" ]; then
                info "Certificate info for $domain:"
                echo "$cert_info" | sed 's/^/    /' | tee -a "$LOG_FILE"
            fi
        else
            warning "HTTPS connection failed for $domain"
        fi
    done
}

# Setup automatic certificate renewal
setup_renewal() {
    info "Setting up automatic certificate renewal..."
    
    # Create renewal script
    local renewal_script="/usr/local/bin/renew-event-api-certs.sh"
    cat > "$renewal_script" << 'EOF'
#!/bin/bash

# Event API Certificate Renewal Script
# Automatically renew Let's Encrypt certificates

LOG_FILE="/var/log/event-api-cert-renewal.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

log "Starting certificate renewal check"

# Attempt renewal
if certbot renew --quiet --no-self-upgrade >> "$LOG_FILE" 2>&1; then
    log "Certificate renewal successful"
    
    # Reload nginx if certificates were renewed
    if systemctl reload nginx >> "$LOG_FILE" 2>&1; then
        log "Nginx reloaded successfully"
    else
        log "ERROR: Failed to reload nginx"
        exit 1
    fi
else
    log "Certificate renewal failed or not needed"
fi

log "Certificate renewal check completed"
EOF
    
    chmod +x "$renewal_script"
    
    # Setup cron job for automatic renewal (twice daily)
    local cron_job="0 0,12 * * * /usr/local/bin/renew-event-api-certs.sh"
    
    # Add to crontab if not already present
    if ! crontab -l 2>/dev/null | grep -q "renew-event-api-certs.sh"; then
        (crontab -l 2>/dev/null; echo "$cron_job") | crontab -
        success "Automatic renewal cron job installed"
    else
        info "Automatic renewal cron job already exists"
    fi
}

# Generate DH parameters for enhanced security
generate_dh_params() {
    info "Generating Diffie-Hellman parameters (this may take a while)..."
    
    local dh_file="/etc/ssl/certs/dhparam.pem"
    
    if [ ! -f "$dh_file" ]; then
        openssl dhparam -out "$dh_file" 2048
        success "DH parameters generated: $dh_file"
    else
        info "DH parameters already exist: $dh_file"
    fi
}

# Run SSL security test
run_security_test() {
    info "Running SSL security tests..."
    
    # Test SSL configuration with OpenSSL
    for domain in "$DOMAIN" "$ADMIN_DOMAIN" "$ML_DOMAIN"; do
        info "Testing SSL security for $domain..."
        
        # Test TLS versions and cipher suites
        local ssl_test_result
        ssl_test_result=$(echo | openssl s_client -connect "$domain:443" -servername "$domain" 2>/dev/null | grep -E "(Protocol|Cipher)")
        
        if [ -n "$ssl_test_result" ]; then
            echo "$ssl_test_result" | sed 's/^/    /' | tee -a "$LOG_FILE"
        fi
    done
}

# Cleanup function
cleanup() {
    info "Cleaning up temporary files..."
    rm -f /tmp/acme-challenge.conf
}

# Main execution
main() {
    info "Starting SSL setup for Event API"
    print_config
    
    # Check prerequisites
    check_prerequisites
    
    # Validate DNS configuration
    local dns_valid=true
    for domain in "$DOMAIN" "$ADMIN_DOMAIN" "$ML_DOMAIN"; do
        if ! validate_domain_dns "$domain"; then
            dns_valid=false
        fi
    done
    
    if [ "$dns_valid" != "true" ]; then
        warning "DNS validation issues detected"
        warning "SSL certificate issuance may fail"
        
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            info "SSL setup cancelled by user"
            exit 0
        fi
    fi
    
    # Setup nginx for ACME challenge
    setup_nginx_acme
    
    # Obtain certificates
    if obtain_certificates; then
        # Install production configuration
        install_production_config
        
        # Generate DH parameters
        generate_dh_params
        
        # Verify certificates
        verify_certificates
        
        # Setup automatic renewal
        setup_renewal
        
        # Run security tests
        run_security_test
        
        success "SSL setup completed successfully!"
        
        info "Next steps:"
        info "1. Verify your application is accessible at https://$DOMAIN"
        info "2. Check admin interface at https://$ADMIN_DOMAIN"
        info "3. Test ML service at https://$ML_DOMAIN"
        info "4. Monitor certificate renewal logs at /var/log/event-api-cert-renewal.log"
        
    else
        error "SSL certificate obtaining failed"
        exit 1
    fi
}

# Trap cleanup
trap cleanup EXIT

# Run main function
if [ "${BASH_SOURCE[0]}" == "${0}" ]; then
    main "$@"
fi