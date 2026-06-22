#!/bin/bash
# Deploy all changes to server
# Run from your terminal: bash ~/Desktop/anmar-engine/deploy_fixes.sh

SERVER="root@104.131.22.108"
BASE_LOCAL="/Users/williamfrackmarquezangarita/Desktop/anmar-engine"
BASE_REMOTE="/var/www/anmar-engine"

echo "Deploying internal messaging system + bug fixes..."

cat "$BASE_LOCAL/frontend/script-v36.js" | ssh "$SERVER" "cat > $BASE_REMOTE/frontend/script-v36.js" && echo "OK script-v36.js" || echo "FAILED script-v36.js"
cat "$BASE_LOCAL/app.py"                  | ssh "$SERVER" "cat > $BASE_REMOTE/app.py"                  && echo "OK app.py"              || echo "FAILED app.py"
cat "$BASE_LOCAL/internal/panel.html"     | ssh "$SERVER" "cat > $BASE_REMOTE/internal/panel.html"     && echo "OK internal/panel.html" || echo "FAILED internal/panel.html"

echo ""
echo "Restarting anmar.service..."
ssh "$SERVER" "systemctl restart anmar.service" && echo "OK service restarted" || echo "WARN could not restart service"

echo ""
echo "Changes deployed:"
echo "  [script-v36.js]"
echo "    1. bmChatSend -> now calls /api/human-chat/send (messages reach internal panel)"
echo "    2. Polling every 6s for employee replies in BM chat"
echo "    3. formatPlanLabel: handles starter/validate/mvp/growth"
echo "    4. Paid users: hide countdown + CTA, show Validation active badge"
echo "  [app.py]"
echo "    5. SMS to admin on every BM chat message from client"
echo "    6. Tickets from BM chat have channel=validate + client_plan"
echo "  [internal/panel.html]"
echo "    7. Validate channel tab - all BM conversations visible there"
echo "    8. Red unread badge on tickets with pending replies"
echo "    9. planBadgeHtml supports starter plan"
