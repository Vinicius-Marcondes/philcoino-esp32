Pod::Spec.new do |s|
  s.name           = 'PhilcoinoSecureTransport'
  s.version        = '1.0.0'
  s.summary        = 'Pinned local HTTPS and SSE transport for Philcoino'
  s.description    = 'Project-local Expo module for pinned HTTPS, ESP-IDF Security 2 SRP pairing, and SSE.'
  s.author         = 'Philcoino'
  s.homepage       = 'https://localhost.invalid'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'ESPProvision', '= 3.1.0'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
