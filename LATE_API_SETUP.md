# Late API Integration Setup Guide

## Overview
This application now integrates with the Late API (https://getlate.dev) to automatically post generated videos to multiple social media platforms including YouTube, TikTok, Instagram, Facebook, Twitter/X, LinkedIn, Threads, and Pinterest.

## Prerequisites

1. **Late Account**: Create an account at https://getlate.dev
2. **Late API Key**: Generate an API key from your Late dashboard
3. **Connected Social Media Accounts**: Connect the social media platforms you want to post to in Late

## Setup Instructions

### 1. Get Your Late API Key

1. Log in to https://getlate.dev
2. Navigate to Settings → API Keys
3. Create a new API key
4. Copy the generated API key

### 2. Configure Environment Variables

Open the `.env` file in the project root and add your Late API key:

```env
LATE_API_KEY=your_actual_api_key_here
```

Replace `your_late_api_key_here` with your actual API key from Late.

### 3. Create and Configure Profiles in Late

1. Log in to your Late account
2. Create a new profile (e.g., "My YouTube Channel", "Personal Brand")
3. Connect social media accounts to this profile:
   - YouTube
   - TikTok
   - Instagram (Business account required)
   - Facebook Page
   - Twitter/X
   - LinkedIn
   - Threads
   - Pinterest

### 4. Using the Integration

#### Step 1: Generate Videos
1. Fill in the script, title, and description for your videos in the grid items
2. Click the "생성" (Generate) button for each item
3. Wait for the video generation to complete

#### Step 2: Select Late Profile
1. In the "소셜 미디어 포스팅 설정" (Social Media Posting Settings) section
2. Select your Late profile from the dropdown
3. The system will automatically load connected accounts for that profile

#### Step 3: Choose Platforms
You have two options:

**Option A: Select All Platforms**
- Check "모든 연결된 플랫폼에 포스팅" (Post to all connected platforms)
- The video will be posted to all active accounts in your profile

**Option B: Select Specific Platforms**
- Check individual platform checkboxes (YouTube, TikTok, Instagram, etc.)
- The video will only be posted to selected platforms

#### Step 4: Post to Social Media
1. Click the "📱 소셜 미디어에 포스팅" (Post to Social Media) button on any completed video
2. The system will:
   - Upload the video to Late's media storage
   - Create a post with your title and description
   - Publish to selected platforms
3. Monitor the status messages for progress updates

## Platform-Specific Notes

### YouTube
- Videos are uploaded immediately as private
- Automatically published as public (or your selected visibility)
- Title and description from your input are used
- Supports both regular videos and Shorts (based on duration)

### TikTok
- Requires TikTok Creator account
- Videos are posted with privacy settings (PUBLIC by default)
- Comments, duets, and stitches are enabled by default

### Instagram
- **Requires Instagram Business Account** (Personal accounts won't work)
- Videos are automatically posted as Reels
- Feed sharing is enabled by default

### Facebook
- Posts to Facebook Pages (not personal profiles)
- Videos appear in the feed with your description

### Twitter/X
- Videos can be up to 2 minutes 20 seconds
- Description is used as the tweet text

### LinkedIn
- Supports both personal profiles and company pages
- Videos appear in the feed with professional formatting

### Threads
- Integration with Meta Threads platform
- Videos posted with description

### Pinterest
- Videos posted as Pins
- Requires a board to be set as default in Late

## Troubleshooting

### "API 키가 설정되지 않았거나 서버 오류가 발생했습니다"
- Check that `LATE_API_KEY` is correctly set in `.env`
- Verify the API key is valid in your Late dashboard
- Restart the server after changing `.env`

### "연결된 계정이 없습니다" (No connected accounts)
- Log in to Late and connect social media accounts to your profile
- Click the "🔄 새로고침" (Refresh) button to reload profiles

### Video Upload Fails
- Check that the video was successfully generated first
- Ensure the video file exists in the outputs directory
- Verify your Late account has sufficient storage/quota

### Post to Platform Fails
- Verify the social media account is still connected in Late
- Check platform-specific requirements (e.g., Instagram Business account)
- Review error messages in the status section

### Instagram Posting Fails
- **Most Common Issue**: Instagram account must be a Business account
- Convert your Instagram account to Business in the Instagram app:
  - Settings → Account → Switch to Professional Account → Business

## API Rate Limits

The Late API has the following rate limits based on your plan:
- **Free**: 60 requests per minute
- **Basic**: 120 requests per minute
- **Professional**: 600 requests per minute
- **Advanced**: 1200 requests per minute

## Features

### Automatic Video Upload
Videos are automatically uploaded to Late's CDN storage, which is optimized for social media delivery.

### Multi-Platform Posting
Post to multiple platforms simultaneously with a single click.

### Platform-Specific Optimization
- YouTube: Proper title, description, and visibility settings
- TikTok: Privacy controls and engagement settings
- Instagram: Automatic Reel formatting
- Others: Platform-appropriate formatting

### Status Tracking
Real-time status updates show:
- Upload progress
- Posting status
- Successful platform publications
- Error messages if any issues occur

## Best Practices

1. **Test First**: Start by posting to one platform to verify everything works
2. **Profile Organization**: Create separate profiles for different brands/channels
3. **Platform Selection**: Only select platforms where you have active audiences
4. **Title & Description**: Write platform-appropriate content (consider character limits)
5. **Monitor Results**: Check the status messages for any platform-specific issues

## Support

- **Late Documentation**: https://code.claude.com/docs/en/claude_code_docs_map.md
- **Late Support**: miki@getlate.dev
- **Late Dashboard**: https://getlate.dev/dashboard

## License

This integration uses the Late API according to their terms of service. Please review Late's documentation for API usage guidelines and pricing.
