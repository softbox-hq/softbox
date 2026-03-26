"use client"

import * as React from "react"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/dashboard/app-sidebar"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { StatsCards } from "@/components/dashboard/stats-cards"
import { AnalyticsCharts } from "@/components/dashboard/analytics-charts"
import { RecentActivity } from "@/components/dashboard/recent-activity"
import { ProjectsList } from "@/components/dashboard/projects-list"

export default function DashboardPage() {
  const [activeTab, setActiveTab] = React.useState("Overview")

  return (
    <SidebarProvider>
      <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <SidebarInset>
        <DashboardHeader activeTab={activeTab} />
        <main className="flex-1 overflow-auto bg-background p-4 md:p-6">
          <div className="mx-auto max-w-7xl space-y-6">
            <StatsCards />
            <AnalyticsCharts />
            <div className="grid gap-6 lg:grid-cols-2">
              <ProjectsList />
              <RecentActivity />
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
