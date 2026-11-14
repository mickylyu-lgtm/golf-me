require 'xcodeproj'
root = File.expand_path('../..', __dir__)
p = Xcodeproj::Project.new('/tmp/GolfMeNotificationTests.xcodeproj')
t = p.new_target(:unit_test_bundle, 'NotificationTests', :ios, '15.0')
['ios/App/NotificationService/NotificationService.swift','ios/App/NotificationService/AvatarDownload.swift','tests/native/NotificationServiceTests.swift'].each{|f|t.source_build_phase.add_file_reference(p.main_group.new_file("#{root}/#{f}"))}
t.build_configurations.each{|c|c.build_settings.merge!({'PRODUCT_NAME'=>'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER'=>'com.golfme.notificationtests','SWIFT_VERSION'=>'5.0','GENERATE_INFOPLIST_FILE'=>'YES','CODE_SIGNING_ALLOWED'=>'NO','TARGETED_DEVICE_FAMILY'=>'1'})}
p.save
s=Xcodeproj::XCScheme.new
s.add_build_target(t)
s.add_test_target(t)
s.save_as(p.path,'NotificationTests',true)
