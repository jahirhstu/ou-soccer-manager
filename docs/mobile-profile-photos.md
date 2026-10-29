# Profile Photos And Account Loading

## Development Setup

Migration `093_native_apps.sql` is applied to the development database. It adds
the authenticated mobile RPCs, `profiles.photo_path`, and the private
`profile-photos` bucket. Missing `mobile_context()` previously caused login to
succeed but account loading to fail. Production was not migrated for this work.

## Photo Upload Flow

1. Request camera/gallery permission and open the native picker.
2. Permit cancellation without changing the current photo.
3. Resize the selected image to 640 pixels wide and encode as JPEG.
4. Read bytes with Expo FileSystem `File.arrayBuffer()` instead of fetching a
   local file URI through the networking stack.
5. Reject empty files and files above 2 MB before uploading.
6. Upload to a unique path under the authenticated profile UUID.
7. Call `set_my_photo` to validate ownership and store the path.
8. Only after linking succeeds, attempt removal of the previous object.
9. Refresh account state; display photos through short-lived signed URLs.

The bucket is private. Object policies permit owners to insert, read and delete
only their own paths. An ordinary authenticated client performs uploads; the app
never contains a secret/service-role key.

## Lifecycle Fix

Native permission prompts and photo pickers can background the app. Previously,
the provider cleared account context on background and replaced the current
screen with a loading/membership screen. That could unmount the photo workflow.
The provider now preserves the screen and revalidates membership quietly on
foreground. Failed refreshes clear context, and server authorization still
applies to every read/write. Explicit sign-out clears local account state.

## Failure Handling

- Permission denied: explain that access can be enabled in device settings.
- Upload failure: retain the existing profile photo and surface the error.
- Linking failure/uncertain response: retain uploaded bytes rather than risk
  deleting a file whose profile update actually committed. This can leave an
  orphan object; periodic orphan cleanup is a future maintenance task.
- Old-file cleanup failure: do not report the new, already-saved photo as failed.
- Expired image URL: View photo requests a fresh signed URL.

## Verification

`lib/tests/mobile-photo.test.ts` tests upload/link/cleanup ordering, empty and
oversized files, upload failure, uncertain linking and cleanup failure.
`lib/tests/native-apps.test.ts` exercises private storage ownership and photo
linking against a local PostgreSQL-compatible test database.

These tests do not operate a physical camera or Supabase's hosted upload HTTP
service. Final device verification: choose photo, save, reopen profile, restart
the app, then repeat with the camera. Confirm cancellation preserves the old
photo and another account cannot read it.

References: [Expo FileSystem](https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/)
and [Supabase React Native storage](https://supabase.com/blog/react-native-storage).
