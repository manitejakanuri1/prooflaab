import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useAvailableTasks } from "@/hooks/useAvailableTasks";
import { format } from "date-fns";
import { Clock, Award, Search, Building2, Calendar, DollarSign, User, Code, Palette, FlaskConical, Briefcase, ShieldCheck } from "lucide-react";
import { TaskApplicationModal } from "./TaskApplicationModal";

const StudentStartupOpportunitiesPage = () => {
  const { data: tasks = [], isLoading } = useAvailableTasks();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [sortBy, setSortBy] = useState("Newest First");

  // Filter only startup tasks
  const startupTasks = useMemo(() => {
    return tasks.filter(task => task.created_by_startup_id);
  }, [tasks]);

  // Filter and sort tasks
  const filteredAndSortedTasks = useMemo(() => {
    let filtered = startupTasks;

    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(task =>
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (task.description && task.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (task.required_skills && task.required_skills.some(skill => 
          skill.toLowerCase().includes(searchQuery.toLowerCase())
        ))
      );
    }

    // Apply category filter
    if (categoryFilter !== "All") {
      filtered = filtered.filter(task => (task.category || 'General') === categoryFilter);
    }

    // Apply sorting
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "XP (High to Low)":
          return (b.xp_reward || 0) - (a.xp_reward || 0);
        case "XP (Low to High)":
          return (a.xp_reward || 0) - (b.xp_reward || 0);
        case "Due Date (Soon to Late)":
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        case "Due Date (Late to Soon)":
          return new Date(b.due_date).getTime() - new Date(a.due_date).getTime();
        case "Oldest First":
          return new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime();
        default: // "Newest First"
          return new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime();
      }
    });
  }, [startupTasks, searchQuery, categoryFilter, sortBy]);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = ["All", ...new Set(startupTasks.map(task => task.category || 'General'))];
    return cats;
  }, [startupTasks]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-2">Startup Opportunities</h2>
          <p className="text-muted-foreground">Real-world tasks from startups looking for talent</p>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="animate-pulse space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-32 bg-muted rounded"></div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getApplicationStatusBadge = (hasApplied: boolean, applicationStatus?: string) => {
    if (!hasApplied) return null;
    
    const colors = {
      'Pending Review': 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20',
      'Accepted': 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
      'Rejected': 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
    } as const;

    return (
      <Badge 
        variant="outline"
        className={colors[applicationStatus as keyof typeof colors] || ''}
      >
        {applicationStatus}
      </Badge>
    );
  };

  const quickFilterCategories = [
    { value: 'All', label: 'All', icon: Building2 },
    { value: 'Coding', label: 'Coding', icon: Code },
    { value: 'Design', label: 'Design', icon: Palette },
    { value: 'Research', label: 'Research', icon: FlaskConical },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Startup Opportunities</h2>
        <p className="text-muted-foreground">Real-world tasks from startups looking for talent</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            Available Opportunities
            <Badge variant="outline" className="ml-auto">
              {filteredAndSortedTasks.length} tasks
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quick Filter Buttons */}
          <div className="flex flex-wrap gap-2">
            {quickFilterCategories.map((cat) => {
              const Icon = cat.icon;
              return (
                <Button
                  key={cat.value}
                  variant={categoryFilter === cat.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCategoryFilter(cat.value)}
                  className="gap-2"
                >
                  <Icon className="h-4 w-4" />
                  {cat.label}
                  {cat.value !== 'All' && (
                    <Badge variant="secondary" className="ml-1">
                      {startupTasks.filter(t => (t.category || 'General') === cat.value).length}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>

          {/* Search & Sort Bar */}
          <div className="flex flex-col gap-3 p-3 sm:p-4 bg-muted/30 rounded-lg border">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Input
                placeholder="Search tasks, skills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>
            
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent className="bg-background border border-border z-50">
                <SelectItem value="Newest First">Newest First</SelectItem>
                <SelectItem value="Oldest First">Oldest First</SelectItem>
                <SelectItem value="XP (High to Low)">XP (High to Low)</SelectItem>
                <SelectItem value="XP (Low to High)">XP (Low to High)</SelectItem>
                <SelectItem value="Due Date (Soon to Late)">Due Date (Soon to Late)</SelectItem>
                <SelectItem value="Due Date (Late to Soon)">Due Date (Late to Soon)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filteredAndSortedTasks.length === 0 ? (
            <div className="text-center py-12">
              <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {startupTasks.length === 0 ? "No startup opportunities available" : "No tasks match your filters"}
              </h3>
              <p className="text-muted-foreground">
                {startupTasks.length === 0 
                  ? "Check back later for new opportunities from startups."
                  : "Try adjusting your search or filter criteria."
                }
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredAndSortedTasks.map((task) => (
                <Card key={task.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-4 mb-4">
                       <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h3 className="text-base sm:text-lg font-semibold text-foreground">{task.title}</h3>
                            <Badge variant="outline" className="text-xs">{task.category || 'General'}</Badge>
                            <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
                              <Briefcase className="h-3 w-3 mr-1" />
                              Startup Posted
                            </Badge>
                             {task.is_paid && (
                               <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-xs">
                                 <DollarSign className="h-3 w-3 mr-1" />
                                 Paid
                               </Badge>
                             )}
                          </div>
                          {task.startup_name && (
                            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                              <Building2 className="h-3 w-3" />
                              {task.startup_name}
                            </p>
                          )}
                         {task.description && (
                           <p className="text-muted-foreground text-xs sm:text-sm mb-3 line-clamp-2">
                             {task.description}
                           </p>
                         )}
                       </div>
                       
                       <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:ml-4">
                         <div className="flex items-center gap-1">
                           <Award className="h-4 w-4 text-orange-500" />
                           <span className="font-semibold text-sm">{task.xp_reward || 0}</span>
                           <span className="text-xs text-muted-foreground">XP</span>
                         </div>
                         {getApplicationStatusBadge(task.has_applied, task.application_status)}
                       </div>
                    </div>

                    {task.required_skills && task.required_skills.length > 0 && (
                      <div className="mb-4">
                        <p className="text-sm font-medium text-foreground mb-2">Required Skills:</p>
                        <div className="flex flex-wrap gap-1">
                          {task.required_skills.map((skill, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    <Separator className="my-3 sm:my-4" />

                     <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                       <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
                         {task.duration_days && (
                           <div className="flex items-center gap-1">
                             <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                             <span className="whitespace-nowrap">{Math.ceil(task.duration_days / 7)} weeks</span>
                           </div>
                         )}
                         <div className="flex items-center gap-1">
                           <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
                           <span className="whitespace-nowrap">Due: {format(new Date(task.due_date), "MMM dd, yyyy")}</span>
                         </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span className="whitespace-nowrap">Posted: {task.created_at ? format(new Date(task.created_at), "MMM dd") : 'Unknown'}</span>
                          </div>
                       </div>
                      
                      <div className="flex gap-2">
                        {!task.has_applied ? (
                          <Button
                            onClick={() => setSelectedTaskId(task.id)}
                            className="bg-orange-600 hover:bg-orange-700 w-full sm:w-auto text-xs sm:text-sm"
                            size="sm"
                          >
                            <User className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                            Apply Now
                          </Button>
                        ) : (
                          <Button variant="outline" disabled className="w-full sm:w-auto text-xs sm:text-sm" size="sm">
                            {task.application_status === 'Accepted' ? 'Accepted' : 
                             task.application_status === 'Rejected' ? 'Rejected' : 'Applied'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Task Application Modal */}
      {selectedTaskId && (
        <TaskApplicationModal
          task={filteredAndSortedTasks.find(t => t.id === selectedTaskId)!}
          isOpen={!!selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
};

export default StudentStartupOpportunitiesPage;
