require 'xcodeproj'
require 'fileutils'
root = File.expand_path('..', __dir__)
directory = File.join(root, 'tmp', 'ocr', 'ios-tests')
FileUtils.mkdir_p(directory)
project = Xcodeproj::Project.new(File.join(directory, 'LocalOCRTests.xcodeproj'))
target = project.new_target(:unit_test_bundle, 'LocalOCRTests', :ios, '15.1')
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.local.doctorocrtests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.9',
    'CODE_SIGN_IDENTITY' => '-',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'SUPPORTED_PLATFORMS' => 'iphonesimulator'
  })
end
['modules/local-pdf/ios/PdfExtractor.swift', 'modules/local-pdf/ios/PhotoDocument.swift', 'tests/native/LocalPdfOCRTests.swift', 'tests/native/PhotoDocumentTests.swift', 'modules/local-pdf/ios/IncomingPdfInbox.swift', 'tests/native/IncomingPdfInboxTests.swift', 'tests/native/PublicReportOCRTests.swift'].each do |path|
  target.source_build_phase.add_file_reference(project.main_group.new_file(File.join(root, path)))
end
['assets/samples/sample-first.pdf', 'private-fixtures/ocr/report-a.pdf', 'private-fixtures/ocr/report-b.pdf'].each do |path|
  absolute = File.join(root, path)
  target.resources_build_phase.add_file_reference(project.main_group.new_file(absolute)) if File.exist?(absolute)
end
if ENV['DOCTOR_OCR_FIXTURES']
  Dir.glob(File.join(File.expand_path(ENV['DOCTOR_OCR_FIXTURES']), '*.pdf')).sort.each do |path|
    target.resources_build_phase.add_file_reference(project.main_group.new_file(path))
  end
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project.path, 'LocalOCRTests', true)
puts 'Local iOS OCR test project prepared; private samples stay in ignored test artifacts.'
