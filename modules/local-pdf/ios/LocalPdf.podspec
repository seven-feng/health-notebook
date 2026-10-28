Pod::Spec.new do |s|
  s.name = 'LocalPdf'
  s.version = '0.1.0'
  s.summary = 'Local PDF extraction and preview'
  s.description = 'Reads PDF text and positions entirely on device.'
  s.license = { :type => 'MIT' }
  s.author = 'Doctor Records'
  s.homepage = 'https://example.invalid/doctor-records'
  s.platforms = { :ios => '15.1' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.frameworks = 'PDFKit', 'CryptoKit', 'Vision'
  s.swift_version = '5.9'
end
