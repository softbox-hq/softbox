"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CheckCircle2, Clock, AlertCircle, XCircle } from "lucide-react"

const activities = [
  {
    id: 1,
    user: { name: "Sarah Chen", avatar: "", initials: "SC" },
    action: "deployed",
    target: "frontend-app",
    status: "success",
    time: "2 min ago",
  },
  {
    id: 2,
    user: { name: "Mike Johnson", avatar: "", initials: "MJ" },
    action: "updated",
    target: "api-gateway",
    status: "pending",
    time: "5 min ago",
  },
  {
    id: 3,
    user: { name: "Emily Davis", avatar: "", initials: "ED" },
    action: "created",
    target: "database-backup",
    status: "success",
    time: "12 min ago",
  },
  {
    id: 4,
    user: { name: "Alex Kim", avatar: "", initials: "AK" },
    action: "rolled back",
    target: "auth-service",
    status: "warning",
    time: "28 min ago",
  },
  {
    id: 5,
    user: { name: "Jordan Lee", avatar: "", initials: "JL" },
    action: "deleted",
    target: "test-environment",
    status: "error",
    time: "1 hour ago",
  },
  {
    id: 6,
    user: { name: "Taylor Swift", avatar: "", initials: "TS" },
    action: "merged",
    target: "feature/new-dashboard",
    status: "success",
    time: "2 hours ago",
  },
]

const statusConfig = {
  success: { icon: CheckCircle2, color: "text-primary", bg: "bg-primary/10" },
  pending: { icon: Clock, color: "text-chart-3", bg: "bg-chart-3/10" },
  warning: { icon: AlertCircle, color: "text-chart-3", bg: "bg-chart-3/10" },
  error: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10" },
}

export function RecentActivity() {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-card-foreground">Recent Activity</CardTitle>
        <CardDescription>Latest deployments and updates from your team</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <div className="space-y-1 p-4 pt-0">
            {activities.map((activity) => {
              const status = statusConfig[activity.status as keyof typeof statusConfig]
              const StatusIcon = status.icon
              
              return (
                <div
                  key={activity.id}
                  className="flex items-center gap-4 rounded-lg p-3 transition-colors hover:bg-accent"
                >
                  <Avatar className="size-9">
                    <AvatarImage src={activity.user.avatar} />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {activity.user.initials}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 space-y-1">
                    <p className="text-sm">
                      <span className="font-medium text-card-foreground">
                        {activity.user.name}
                      </span>{" "}
                      <span className="text-muted-foreground">{activity.action}</span>{" "}
                      <span className="font-medium text-card-foreground">
                        {activity.target}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">{activity.time}</p>
                  </div>
                  
                  <div className={`rounded-full p-1.5 ${status.bg}`}>
                    <StatusIcon className={`size-4 ${status.color}`} />
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
