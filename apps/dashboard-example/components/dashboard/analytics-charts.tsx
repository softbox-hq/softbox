"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

const areaData = [
  { time: "00:00", requests: 2400, errors: 24 },
  { time: "04:00", requests: 1398, errors: 14 },
  { time: "08:00", requests: 9800, errors: 98 },
  { time: "12:00", requests: 3908, errors: 39 },
  { time: "16:00", requests: 4800, errors: 48 },
  { time: "20:00", requests: 3800, errors: 38 },
  { time: "Now", requests: 4300, errors: 43 },
]

const barData = [
  { name: "Mon", value: 400 },
  { name: "Tue", value: 300 },
  { name: "Wed", value: 520 },
  { name: "Thu", value: 400 },
  { name: "Fri", value: 650 },
  { name: "Sat", value: 380 },
  { name: "Sun", value: 290 },
]

const lineData = [
  { time: "Jan", users: 4000 },
  { time: "Feb", users: 3000 },
  { time: "Mar", users: 5000 },
  { time: "Apr", users: 4500 },
  { time: "May", users: 6000 },
  { time: "Jun", users: 5500 },
]

export function AnalyticsCharts() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
      <Card className="col-span-full lg:col-span-4 border-border bg-card">
        <CardHeader>
          <CardTitle className="text-card-foreground">Edge Requests</CardTitle>
          <CardDescription className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-chart-1" />
              2XX
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-chart-4" />
              Errors
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={areaData}>
              <defs>
                <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="oklch(0.72 0.19 155)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="oklch(0.72 0.19 155)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                stroke="oklch(0.60 0 0)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="oklch(0.60 0 0)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value / 1000}K`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "oklch(0.15 0.01 260)",
                  border: "1px solid oklch(0.25 0.01 260)",
                  borderRadius: "8px",
                  color: "oklch(0.96 0 0)",
                }}
              />
              <Area
                type="monotone"
                dataKey="requests"
                stroke="oklch(0.72 0.19 155)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorRequests)"
              />
              <Line
                type="monotone"
                dataKey="errors"
                stroke="oklch(0.65 0.20 350)"
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="col-span-full lg:col-span-3 border-border bg-card">
        <CardHeader>
          <CardTitle className="text-card-foreground">Weekly Activity</CardTitle>
          <CardDescription>Function invocations per day</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={barData}>
              <XAxis
                dataKey="name"
                stroke="oklch(0.60 0 0)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="oklch(0.60 0 0)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "oklch(0.15 0.01 260)",
                  border: "1px solid oklch(0.25 0.01 260)",
                  borderRadius: "8px",
                  color: "oklch(0.96 0 0)",
                }}
              />
              <Bar
                dataKey="value"
                fill="oklch(0.65 0.18 250)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="col-span-full lg:col-span-4 border-border bg-card">
        <CardHeader>
          <CardTitle className="text-card-foreground">User Growth</CardTitle>
          <CardDescription>Monthly active users</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={lineData}>
              <XAxis
                dataKey="time"
                stroke="oklch(0.60 0 0)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="oklch(0.60 0 0)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value / 1000}K`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "oklch(0.15 0.01 260)",
                  border: "1px solid oklch(0.25 0.01 260)",
                  borderRadius: "8px",
                  color: "oklch(0.96 0 0)",
                }}
              />
              <Line
                type="monotone"
                dataKey="users"
                stroke="oklch(0.70 0.16 70)"
                strokeWidth={2}
                dot={{ fill: "oklch(0.70 0.16 70)", strokeWidth: 0, r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="col-span-full lg:col-span-3 border-border bg-card">
        <CardHeader>
          <CardTitle className="text-card-foreground">GB-Hours</CardTitle>
          <CardDescription className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-chart-1" />
              Consumed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-chart-4" />
              Saved
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Consumed</span>
              <span className="text-xl font-bold text-chart-1">21,871.13 GB-hrs</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Saved</span>
              <span className="text-xl font-bold text-chart-4">11,013.52 GB-hrs</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="flex h-full">
                <div className="h-full w-[66%] bg-chart-1" />
                <div className="h-full w-[34%] bg-chart-4" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
