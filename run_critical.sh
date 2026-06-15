#!/bin/bash
for file in *.html; do
  if [ "$file" = "index_test.html" ]; then
    continue
  fi
  echo "Processing $file..."
  npx -y critical "$file" --base . --inline --css assets/bootstrap/css/bootstrap.min.css --css assets/css/bs-theme-overrides.css > "critical_$file"
  mv "critical_$file" "$file"
done
echo "Critical CSS inlining completed!"
