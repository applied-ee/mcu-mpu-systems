.PHONY: html server publish clean

# Build the site to public/
html:
	hugo --minify

# Run local development server with live reload
server:
	hugo server --bind 0.0.0.0 --baseURL http://localhost:1313/mcu-mpu-systems/

# Alternative: serve built site with Python (no live reload)
serve-static: html
	cd public && python3 -m http.server 8000

# Push to GitHub to trigger Actions deployment
publish:
	git push origin main

# Clean build artifacts
clean:
	rm -rf public/ resources/
