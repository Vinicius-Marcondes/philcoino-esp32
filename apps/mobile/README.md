# Philcoino mobile app

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

From the repository root, install dependencies:

   ```bash
   bun install
   ```

Then start the app from the repository root:

   ```bash
   bun run start
   ```

To run the dashboard without connecting to an ESP32, enable the debug device
client:

   ```bash
   EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run start
   ```

Debug device mode bypasses discovery, secure restore, and authentication. Live
temperature and uptime readings stay at `0`; target defaults remain within the
shared protocol ranges so dashboard controls can render and acknowledge changes
locally.

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing files in `apps/mobile/app`. This project uses [file-based routing](https://docs.expo.dev/versions/v54.0.0/router/introduction/).

## Get a fresh project

When you're ready, run:

```bash
bun run --cwd apps/mobile reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo SDK 54 documentation](https://docs.expo.dev/versions/v54.0.0/): Learn fundamentals and APIs for the project-pinned SDK.
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
