import requests
import sys
import json
import base64
from datetime import datetime
import time

class SocialNetworkAPITester:
    def __init__(self, base_url="https://tweetgram-social.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.token = None
        self.user_id = None
        self.username = None
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        
        self.test_results.append({
            "name": name,
            "success": success,
            "details": details
        })

    def run_test(self, name, method, endpoint, expected_status, data=None, files=None, form_data=False):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                if files or form_data:
                    response = requests.post(url, data=data, files=files, headers=headers)
                else:
                    headers['Content-Type'] = 'application/json'
                    response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                if files or form_data:
                    response = requests.put(url, data=data, files=files, headers=headers)
                else:
                    headers['Content-Type'] = 'application/json'
                    response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expected_status
            details = f"Status: {response.status_code}"
            
            if not success:
                details += f", Expected: {expected_status}"
                try:
                    error_data = response.json()
                    details += f", Error: {error_data.get('detail', 'Unknown error')}"
                except:
                    details += f", Response: {response.text[:100]}"

            self.log_test(name, success, details)
            
            if success:
                try:
                    return response.json()
                except:
                    return {}
            return None

        except Exception as e:
            self.log_test(name, False, f"Exception: {str(e)}")
            return None

    def test_user_registration(self):
        """Test user registration"""
        timestamp = int(time.time())
        test_data = {
            "username": f"testuser_{timestamp}",
            "email": f"test_{timestamp}@example.com",
            "password": "TestPass123!",
            "bio": "Test user bio"
        }
        
        result = self.run_test(
            "User Registration",
            "POST",
            "auth/register",
            200,
            data=test_data
        )
        
        if result and 'token' in result and 'user' in result:
            self.token = result['token']
            self.user_id = result['user']['id']
            self.username = result['user']['username']
            return True
        return False

    def test_user_login(self):
        """Test user login with existing credentials"""
        if not self.username:
            return False
            
        # Try to login with the registered user
        login_data = {
            "email": f"test_{int(time.time())}@example.com",
            "password": "TestPass123!"
        }
        
        # First register a user for login test
        timestamp = int(time.time()) + 1
        reg_data = {
            "username": f"loginuser_{timestamp}",
            "email": f"login_{timestamp}@example.com", 
            "password": "LoginPass123!",
            "bio": "Login test user"
        }
        
        reg_result = self.run_test(
            "User Registration for Login Test",
            "POST", 
            "auth/register",
            200,
            data=reg_data
        )
        
        if not reg_result:
            return False
            
        # Now test login
        login_data = {
            "email": f"login_{timestamp}@example.com",
            "password": "LoginPass123!"
        }
        
        result = self.run_test(
            "User Login",
            "POST",
            "auth/login", 
            200,
            data=login_data
        )
        
        return result is not None

    def test_get_current_user(self):
        """Test getting current user info"""
        result = self.run_test(
            "Get Current User",
            "GET",
            "auth/me",
            200
        )
        return result is not None

    def test_create_text_post(self):
        """Test creating a text-only post"""
        # Posts endpoint expects form data, not JSON
        data = {
            "content": "This is a test post with text only!"
        }
        
        result = self.run_test(
            "Create Text Post",
            "POST",
            "posts",
            200,
            data=data,
            form_data=True
        )
        
        if result and 'id' in result:
            self.test_post_id = result['id']
            return True
        return False

    def test_create_post_with_image(self):
        """Test creating a post with image"""
        # Create a simple test image (1x1 pixel PNG)
        test_image_data = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==')
        
        files = {
            'media': ('test.png', test_image_data, 'image/png')
        }
        data = {
            'content': 'Test post with image'
        }
        
        result = self.run_test(
            "Create Post with Image",
            "POST", 
            "posts",
            200,
            data=data,
            files=files
        )
        
        if result and 'id' in result:
            self.test_image_post_id = result['id']
            return True
        return False

    def test_get_feed(self):
        """Test getting user feed"""
        result = self.run_test(
            "Get User Feed",
            "GET",
            "posts/feed",
            200
        )
        return result is not None

    def test_like_post(self):
        """Test liking a post"""
        if not hasattr(self, 'test_post_id'):
            return False
            
        result = self.run_test(
            "Like Post",
            "POST",
            f"posts/{self.test_post_id}/like",
            200
        )
        return result is not None

    def test_unlike_post(self):
        """Test unliking a post (toggle like)"""
        if not hasattr(self, 'test_post_id'):
            return False
            
        result = self.run_test(
            "Unlike Post",
            "POST",
            f"posts/{self.test_post_id}/like",
            200
        )
        return result is not None

    def test_share_post(self):
        """Test sharing a post"""
        if not hasattr(self, 'test_post_id'):
            return False
            
        result = self.run_test(
            "Share Post",
            "POST",
            f"posts/{self.test_post_id}/share",
            200
        )
        return result is not None

    def test_comment_on_post(self):
        """Test commenting on a post"""
        if not hasattr(self, 'test_post_id'):
            return False
            
        comment_data = {
            "content": "This is a test comment!"
        }
        
        result = self.run_test(
            "Comment on Post",
            "POST",
            f"posts/{self.test_post_id}/comments",
            200,
            data=comment_data
        )
        
        if result and 'id' in result:
            self.test_comment_id = result['id']
            return True
        return False

    def test_get_post_comments(self):
        """Test getting comments for a post"""
        if not hasattr(self, 'test_post_id'):
            return False
            
        result = self.run_test(
            "Get Post Comments",
            "GET",
            f"posts/{self.test_post_id}/comments",
            200
        )
        return result is not None

    def test_get_post_details(self):
        """Test getting individual post details"""
        if not hasattr(self, 'test_post_id'):
            return False
            
        result = self.run_test(
            "Get Post Details",
            "GET",
            f"posts/{self.test_post_id}",
            200
        )
        return result is not None

    def test_update_profile(self):
        """Test updating user profile"""
        data = {
            'bio': 'Updated bio for testing'
        }
        
        result = self.run_test(
            "Update Profile",
            "PUT",
            "auth/profile",
            200,
            data=data
        )
        return result is not None

    def test_search_users(self):
        """Test searching for users"""
        result = self.run_test(
            "Search Users",
            "GET",
            f"users/search?q={self.username[:5]}",
            200
        )
        return result is not None

    def test_search_posts(self):
        """Test searching for posts"""
        result = self.run_test(
            "Search Posts",
            "GET",
            "search/posts?q=test",
            200
        )
        return result is not None

    def test_get_user_profile(self):
        """Test getting user profile"""
        if not self.user_id:
            return False
            
        result = self.run_test(
            "Get User Profile",
            "GET",
            f"users/{self.user_id}",
            200
        )
        return result is not None

    def test_get_user_posts(self):
        """Test getting user's posts"""
        if not self.user_id:
            return False
            
        result = self.run_test(
            "Get User Posts",
            "GET",
            f"users/{self.user_id}/posts",
            200
        )
        return result is not None

    def test_follow_user(self):
        """Test following a user (self-follow should fail)"""
        if not self.user_id:
            return False
            
        # This should fail as you can't follow yourself
        result = self.run_test(
            "Follow User (Self - Should Fail)",
            "POST",
            f"users/{self.user_id}/follow",
            400  # Expecting 400 error
        )
        return result is None  # None means it failed as expected

    def test_send_message(self):
        """Test sending a direct message"""
        if not self.user_id:
            return False
            
        # Create another user to send message to
        timestamp = int(time.time()) + 2
        recipient_data = {
            "username": f"recipient_{timestamp}",
            "email": f"recipient_{timestamp}@example.com",
            "password": "RecipientPass123!",
            "bio": "Message recipient"
        }
        
        recipient_result = self.run_test(
            "Create Recipient User",
            "POST",
            "auth/register",
            200,
            data=recipient_data
        )
        
        if not recipient_result:
            return False
            
        recipient_id = recipient_result['user']['id']
        
        message_data = {
            "recipient_id": recipient_id,
            "content": "Test direct message"
        }
        
        result = self.run_test(
            "Send Direct Message",
            "POST",
            "messages",
            200,
            data=message_data
        )
        
        if result:
            self.recipient_id = recipient_id
            return True
        return False

    def test_get_conversations(self):
        """Test getting message conversations"""
        result = self.run_test(
            "Get Conversations",
            "GET",
            "messages/conversations",
            200
        )
        return result is not None

    def test_get_messages_with_user(self):
        """Test getting messages with specific user"""
        if not hasattr(self, 'recipient_id'):
            return False
            
        result = self.run_test(
            "Get Messages with User",
            "GET",
            f"messages/{self.recipient_id}",
            200
        )
        return result is not None

    def test_get_notifications(self):
        """Test getting notifications"""
        result = self.run_test(
            "Get Notifications",
            "GET",
            "notifications",
            200
        )
        return result is not None

    def test_mark_all_notifications_read(self):
        """Test marking all notifications as read"""
        result = self.run_test(
            "Mark All Notifications Read",
            "PUT",
            "notifications/read-all",
            200
        )
        return result is not None

    def run_all_tests(self):
        """Run all backend API tests"""
        print("🚀 Starting Social Network API Tests...")
        print(f"Backend URL: {self.base_url}")
        
        # Authentication Tests
        print("\n📝 Authentication Tests")
        if not self.test_user_registration():
            print("❌ Registration failed, stopping tests")
            return False
            
        self.test_user_login()
        self.test_get_current_user()
        
        # Post Tests
        print("\n📄 Post Tests")
        self.test_create_text_post()
        self.test_create_post_with_image()
        self.test_get_feed()
        self.test_get_post_details()
        
        # Interaction Tests
        print("\n❤️ Interaction Tests")
        self.test_like_post()
        self.test_unlike_post()
        self.test_share_post()
        self.test_comment_on_post()
        self.test_get_post_comments()
        
        # Profile Tests
        print("\n👤 Profile Tests")
        self.test_update_profile()
        self.test_get_user_profile()
        self.test_get_user_posts()
        self.test_follow_user()
        
        # Search Tests
        print("\n🔍 Search Tests")
        self.test_search_users()
        self.test_search_posts()
        
        # Messaging Tests
        print("\n💬 Messaging Tests")
        self.test_send_message()
        self.test_get_conversations()
        self.test_get_messages_with_user()
        
        # Notification Tests
        print("\n🔔 Notification Tests")
        self.test_get_notifications()
        self.test_mark_all_notifications_read()
        
        # Print results
        print(f"\n📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        success_rate = (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
        print(f"Success Rate: {success_rate:.1f}%")
        
        return self.tests_passed == self.tests_run

def main():
    tester = SocialNetworkAPITester()
    success = tester.run_all_tests()
    
    # Save detailed results
    results = {
        "timestamp": datetime.now().isoformat(),
        "total_tests": tester.tests_run,
        "passed_tests": tester.tests_passed,
        "success_rate": (tester.tests_passed / tester.tests_run) * 100 if tester.tests_run > 0 else 0,
        "test_details": tester.test_results
    }
    
    with open('/app/backend_test_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())