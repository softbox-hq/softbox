"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, ExternalLink, Star, GitBranch } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const projects = [
  {
    id: 1,
    name: "Frontend App",
    description: "Main production application",
    status: "active",
    framework: "Next.js",
    lastDeployed: "2 hours ago",
    branch: "main",
    starred: true,
  },
  {
    id: 2,
    name: "API Gateway",
    description: "REST and GraphQL APIs",
    status: "active",
    framework: "Node.js",
    lastDeployed: "4 hours ago",
    branch: "main",
    starred: true,
  },
  {
    id: 3,
    name: "Admin Dashboard",
    description: "Internal tools and management",
    status: "active",
    framework: "React",
    lastDeployed: "1 day ago",
    branch: "develop",
    starred: false,
  },
  {
    id: 4,
    name: "Auth Service",
    description: "Authentication microservice",
    status: "building",
    framework: "Go",
    lastDeployed: "Building...",
    branch: "feature/oauth",
    starred: false,
  },
  {
    id: 5,
    name: "Documentation",
    description: "Developer documentation site",
    status: "active",
    framework: "Astro",
    lastDeployed: "3 days ago",
    branch: "main",
    starred: false,
  },
]

const statusColors = {
  active: "bg-primary/20 text-primary border-primary/30",
  building: "bg-chart-3/20 text-chart-3 border-chart-3/30",
  error: "bg-destructive/20 text-destructive border-destructive/30",
}

export function ProjectsList() {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-card-foreground">Projects</CardTitle>
          <CardDescription>Your recent projects and deployments</CardDescription>
        </div>
        <Button variant="outline" size="sm" className="text-muted-foreground">
          View All
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="group flex items-center justify-between rounded-lg border border-border bg-background p-4 transition-all hover:border-primary/50 hover:bg-accent"
            >
              <div className="flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground">
                  {project.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-card-foreground">{project.name}</h4>
                    {project.starred && (
                      <Star className="size-3 fill-chart-3 text-chart-3" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{project.description}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="hidden items-center gap-1.5 text-sm text-muted-foreground md:flex">
                  <GitBranch className="size-3" />
                  {project.branch}
                </div>
                <Badge
                  variant="outline"
                  className={statusColors[project.status as keyof typeof statusColors]}
                >
                  {project.status}
                </Badge>
                <span className="hidden text-xs text-muted-foreground lg:block">
                  {project.lastDeployed}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                      <ExternalLink className="mr-2 size-4" />
                      View Site
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Star className="mr-2 size-4" />
                      {project.starred ? "Unstar" : "Star"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
