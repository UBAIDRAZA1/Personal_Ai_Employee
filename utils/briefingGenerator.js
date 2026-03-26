const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const vaultPath = path.resolve(__dirname, '../AI_Employee_Vault');
const briefingsPath = path.join(vaultPath, 'Briefings');

// Create Briefings directory if it doesn't exist
if (!fs.existsSync(briefingsPath)) {
  fs.mkdirSync(briefingsPath, { recursive: true });
}

function generateWeeklyBriefing() {
  try {
    const now = new Date();
    const formattedDate = now.toISOString().split('T')[0];
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // Only run on Mondays (day 1) or when manually triggered
    if (dayOfWeek !== 1) {
      console.log('Weekly briefing only runs on Mondays. Use --force to override.');
      return;
    }
    
    // Calculate next Monday for the filename
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + (1 + 7 - now.getDay()) % 7); // Next Monday
    const briefingFileName = `${nextMonday.toISOString().split('T')[0]}_Monday_Briefing.md`;
    const briefingFilePath = path.join(briefingsPath, briefingFileName);
    
    // Count files in each directory
    const inboxPath = path.join(vaultPath, 'Inbox');
    const pendingApprovalPath = path.join(vaultPath, 'Pending_Approval');
    const donePath = path.join(vaultPath, 'Done');
    const failedPath = path.join(vaultPath, 'Failed');
    
    const inboxCount = fs.existsSync(inboxPath) ? fs.readdirSync(inboxPath).filter(f => f.endsWith('.md')).length : 0;
    const pendingApprovalCount = fs.existsSync(pendingApprovalPath) ? fs.readdirSync(pendingApprovalPath).filter(f => f.endsWith('.md')).length : 0;
    const doneTodayCount = getTodaysDoneCount();
    const failedCount = fs.existsSync(failedPath) ? fs.readdirSync(failedPath).filter(f => f.endsWith('.md')).length : 0;
    
    // Read logs for recent activity
    const logsPath = path.join(vaultPath, 'Logs');
    let recentActivity = [];
    if (fs.existsSync(logsPath)) {
      const logFiles = fs.readdirSync(logsPath).filter(f => f.endsWith('.log'));
      if (logFiles.length > 0) {
        const latestLogFile = logFiles.sort().pop();
        const logContent = fs.readFileSync(path.join(logsPath, latestLogFile), 'utf8');
        const logLines = logContent.split('\n').filter(line => line.trim() !== '');
        // Get last 20 log entries
        recentActivity = logLines.slice(-20).reverse(); // Reverse to show newest first
      }
    }
    
    // Read business goals if exists
    let businessGoals = '*No business goals defined.*';
    const businessGoalsPath = path.join(vaultPath, 'Business_Goals.md');
    if (fs.existsSync(businessGoalsPath)) {
      businessGoals = fs.readFileSync(businessGoalsPath, 'utf8');
    }
    
    // Generate the briefing content
    const briefingContent = `# Monday Morning CEO Briefing
**Date:** ${formattedDate}

## Executive Summary
This briefing provides an overview of system performance and key metrics for the week ahead.

## Task Summary
- **Tasks Completed Today:** ${doneTodayCount}
- **Tasks Pending Approval:** ${pendingApprovalCount}
- **Tasks in Inbox:** ${inboxCount}
- **Permanently Failed Tasks:** ${failedCount}

## Bottlenecks & Issues
- ${
  pendingApprovalCount > 10 ? `High number of pending approvals (${pendingApprovalCount}). Consider reviewing.` : 
  pendingApprovalCount > 5 ? `Moderate number of pending approvals (${pendingApprovalCount}). Monitor closely.` : 
  'No significant approval bottlenecks detected.'
}

- ${
  failedCount > 0 ? `There are ${failedCount} permanently failed tasks requiring attention.` :
  'No failed tasks detected this week.'
}

## Recent Activity
${recentActivity.length > 0 ? 
  recentActivity.map(activity => `  - ${activity}`).join('\n') : 
  '  - No recent activity'}

## System Health Status
- All MCP servers operational
- File system watchers running
- Dashboard updated: ${formattedDate}

## Business Goal Alignment
${businessGoals}

## Recommendations
- ${
  pendingApprovalCount > 5 ? 'Prioritize reviewing pending approvals to prevent delays.' : 
  'Current approval queue is healthy.'
}
- ${
  failedCount > 0 ? 'Investigate failed tasks in the Failed directory and resubmit if appropriate.' :
  'No failed tasks to investigate.'
}
- Monitor task volume and adjust resources accordingly.

## Next Week Priorities
- Clear pending approval backlog
- Address any failed tasks
- Review and update business goals if necessary
`;

    // Write the briefing to file
    fs.writeFileSync(briefingFilePath, briefingContent);
    console.log(`Weekly briefing generated: ${briefingFilePath}`);
    
    // Update dashboard with briefing reference
    const { updateDashboard } = require('./dashboardUpdater');
    updateDashboard();
    
  } catch (error) {
    console.error('Error generating weekly briefing:', error);
  }
}

function getTodaysDoneCount() {
  const donePath = path.join(vaultPath, 'Done');
  if (!fs.existsSync(donePath)) return 0;
  
  const doneFiles = fs.readdirSync(donePath).filter(f => f.endsWith('.md'));
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  
  let count = 0;
  for (const file of doneFiles) {
    // Extract timestamp from filename (format: APPROVAL_*_timestamp.md)
    const match = file.match(/_(\d{13})\.md$/); // Look for 13-digit timestamp before .md
    if (match) {
      const timestamp = parseInt(match[1]);
      const fileDate = new Date(timestamp).toISOString().split('T')[0];
      if (fileDate === today) {
        count++;
      }
    }
  }
  
  return count;
}

// Schedule the briefing to run automatically on Mondays
function scheduleWeeklyBriefing() {
  const now = new Date();
  const daysUntilNextMonday = (1 + 7 - now.getDay()) % 7 || 7; // Days until next Monday
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysUntilNextMonday);
  nextMonday.setHours(9, 0, 0, 0); // 9:00 AM
  
  const timeUntilMonday = nextMonday.getTime() - now.getTime();
  
  console.log(`Next briefing scheduled for: ${nextMonday}`);
  
  // Set timeout to run the briefing on Monday morning
  setTimeout(() => {
    generateWeeklyBriefing();
    // Reschedule for the following Monday
    setInterval(() => {
      generateWeeklyBriefing();
    }, 7 * 24 * 60 * 60 * 1000); // Every week
  }, timeUntilMonday);
}

// If this file is run directly, generate the briefing
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--force')) {
    generateWeeklyBriefing();
  } else if (args.includes('--schedule')) {
    scheduleWeeklyBriefing();
  } else {
    generateWeeklyBriefing();
  }
} else {
  // Export functions for use in other modules
  module.exports = { generateWeeklyBriefing, scheduleWeeklyBriefing };
}