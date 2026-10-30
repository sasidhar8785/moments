# Moments for iPhone and iPad

A native ARKit app: find the floor, tap to place the creator, drag to move them, and tap ⏺ to
record the moment (saved or shared from the preview screen).

- **World tracking:** the creator stays on the spot you placed them as you walk around.
- **People occlusion** (devices with an A12 chip or newer): you can pass in front of them.
- **LiDAR occlusion** (iPad Pro, iPhone Pro): real furniture can hide them.
- **Light matching:** they dim in darker rooms.

The creator clips are the same ones the web page uses (`web/ar/creators`), copied into the app.

## Run it on your iPad (Mac with Xcode)

1. Install **Xcode** from the Mac App Store and open it once.
2. Get the code: `git clone https://github.com/sasidhar8785/moments` (or download the ZIP from GitHub).
3. Open `ios/Moments.xcodeproj` in Xcode.
4. Click **Moments** in the left sidebar → **Signing & Capabilities** → **Team**: choose your
   Apple ID (**Add an Account…** if it's not listed). A free Apple ID works.
5. Connect the iPad with a cable, unlock it, and tap **Trust** if asked. Choose it from the
   device menu at the top of Xcode.
6. Press **Run** (▶).
7. First time only, on the iPad: **Settings → General → VPN & Device Management** → your Apple ID →
   **Trust**. Also, on iPadOS 16 or later, turn on **Settings → Privacy & Security → Developer Mode**
   and restart when asked. Then press Run again.

With a free Apple ID the app stops opening after 7 days; press Run again to reinstall.

`ios/Moments.xcodeproj` is generated from `ios/project.yml` by XcodeGen and committed by CI.
Change `project.yml`, not the project file.
