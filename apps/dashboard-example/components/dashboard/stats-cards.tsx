"use client"

import { ArrowUpRight, ArrowDownRight, TrendingUp, Users, Globe, Zap } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const stats = [
  {
    title: "Edge Requests",
    value: "2.4M",
    change: "+12.5%",
    trend: "up",
    icon: Globe,
    description: "Last 24 hours",
  },
  {
    title: "Active Users",
    value: "18.2K",
    change: "+8.1%",
    trend: "up",
    icon: Users,
    description: "Currently online",
  },
  {
    title: "Function Invocations",
    value: "847K",
    change: "-2.4%",
    trend: "down",
    icon: Zap,
    description: "Last 24 hours",
  },
  {
    title: "Bandwidth",
    value: "496GB",
    change: "+18.2%",
    trend: "up",
    icon: TrendingUp,
    description: "Data transferred",
  },
]

export function StatsCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.title} className="border-border bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {stat.title}
            </CardTitle>
            <stat.icon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-card-foreground">{stat.value}</div>
            <div className="flex items-center gap-1 text-xs">
              {stat.trend === "up" ? (
                <ArrowUpRight className="size-3 text-primary" />
              ) : (
                <ArrowDownRight className="size-3 text-destructive" />
              )}
              <span className={stat.trend === "up" ? "text-primary" : "text-destructive"}>
                {stat.change}
              </span>
              <span className="text-muted-foreground">{stat.description}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
