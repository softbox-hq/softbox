"use client"

import * as React from "react"
import {
  LayoutDashboard,
  BarChart3,
  Users,
  Settings,
  FolderOpen,
  Bell,
  HelpCircle,
  LogOut,
  ChevronRight,
  Zap,
  Globe,
  Database,
  Shield,
  Code,
  Search,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

const mainNavItems = [
  {
    title: "Overview",
    icon: LayoutDashboard,
    isActive: true,
  },
  {
    title: "Analytics",
    icon: BarChart3,
    subItems: [
      { title: "Edge Requests", href: "#" },
      { title: "Fast Data Transfer", href: "#" },
      { title: "Functions", href: "#" },
    ],
  },
  {
    title: "Projects",
    icon: FolderOpen,
    badge: "12",
    subItems: [
      { title: "All Projects", href: "#" },
      { title: "Starred", href: "#" },
      { title: "Archived", href: "#" },
    ],
  },
  {
    title: "Team",
    icon: Users,
  },
]

const computeItems = [
  { title: "Functions", icon: Zap },
  { title: "Edge Functions", icon: Globe },
  { title: "Data Cache", icon: Database },
]

const settingsItems = [
  { title: "General", icon: Settings },
  { title: "Security", icon: Shield },
  { title: "API Keys", icon: Code },
]

interface AppSidebarProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

export function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
            <Zap className="size-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-sidebar-foreground">Acme Inc</span>
            <span className="text-xs text-muted-foreground">Enterprise</span>
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup className="px-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <SidebarInput placeholder="Search..." className="pl-9" />
          </div>
        </SidebarGroup>
        
        <SidebarSeparator />
        
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <React.Fragment key={item.title}>
                  {item.subItems ? (
                    <Collapsible asChild className="group/collapsible">
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            isActive={activeTab === item.title}
                            onClick={() => onTabChange(item.title)}
                          >
                            <item.icon className="size-4" />
                            <span>{item.title}</span>
                            <ChevronRight className="ml-auto size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.subItems.map((subItem) => (
                              <SidebarMenuSubItem key={subItem.title}>
                                <SidebarMenuSubButton asChild>
                                  <a href={subItem.href}>{subItem.title}</a>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  ) : (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        isActive={activeTab === item.title}
                        onClick={() => onTabChange(item.title)}
                      >
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </React.Fragment>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        <SidebarSeparator />
        
        <SidebarGroup>
          <SidebarGroupLabel>Compute</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {computeItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={activeTab === item.title}
                    onClick={() => onTabChange(item.title)}
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        <SidebarSeparator />
        
        <SidebarGroup>
          <SidebarGroupLabel>Settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={activeTab === item.title}
                    onClick={() => onTabChange(item.title)}
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <Bell className="size-4" />
              <span>Notifications</span>
              <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">3</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <HelpCircle className="size-4" />
              <span>Help & Support</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        
        <SidebarSeparator />
        
        <div className="flex items-center gap-3 p-2">
          <Avatar className="size-8">
            <AvatarImage src="/placeholder-user.jpg" />
            <AvatarFallback className="bg-primary/20 text-primary text-xs">JD</AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-medium text-sidebar-foreground">John Doe</span>
            <span className="text-xs text-muted-foreground">john@acme.com</span>
          </div>
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
            <LogOut className="size-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
