"use client"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Bell, Search, Plus, ChevronDown, Calendar } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface DashboardHeaderProps {
  activeTab: string
}

export function DashboardHeader({ activeTab }: DashboardHeaderProps) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-background px-4 md:px-6">
      <div className="flex items-center gap-4">
        <SidebarTrigger className="md:hidden" />
        <div className="hidden md:block">
          <h1 className="text-xl font-semibold text-foreground">{activeTab}</h1>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search..."
            className="w-64 bg-muted pl-9"
          />
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="hidden gap-2 md:flex">
              <Calendar className="size-4" />
              Last 12 hours
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Last hour</DropdownMenuItem>
            <DropdownMenuItem>Last 6 hours</DropdownMenuItem>
            <DropdownMenuItem>Last 12 hours</DropdownMenuItem>
            <DropdownMenuItem>Last 24 hours</DropdownMenuItem>
            <DropdownMenuItem>Last 7 days</DropdownMenuItem>
            <DropdownMenuItem>Last 30 days</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        
        <Button size="sm" className="gap-2">
          <Plus className="size-4" />
          <span className="hidden md:inline">New Project</span>
        </Button>
        
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-5" />
          <Badge className="absolute -top-1 -right-1 flex size-5 items-center justify-center p-0 text-[10px]">
            3
          </Badge>
        </Button>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="size-8">
                <AvatarImage src="/placeholder-user.jpg" />
                <AvatarFallback className="bg-primary/20 text-primary text-xs">JD</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>John Doe</span>
                <span className="text-xs font-normal text-muted-foreground">john@acme.com</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem>Billing</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
