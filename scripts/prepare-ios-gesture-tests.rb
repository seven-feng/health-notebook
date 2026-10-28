require 'xcodeproj'
require 'fileutils'
root = File.expand_path('..', __dir__)
directory = File.join(root, 'tmp', 'gesture-tests')
FileUtils.mkdir_p(directory)
project = Xcodeproj::Project.new(File.join(directory, 'SourceGestureTests.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'SourceGestureTests', :ios, '15.1')
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.local.doctorgesturetests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.9',
    'CODE_SIGN_IDENTITY' => '-',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'SUPPORTED_PLATFORMS' => 'iphonesimulator'
  })
end
target.source_build_phase.add_file_reference(project.main_group.new_file(File.join(root, 'tests/native/SourceGestureTests.swift')))
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project.path, 'SourceGestureTests', true)
puts 'Gesture test project prepared. Open the synthetic image with .maestro/source-preview-ready.yaml first.'
