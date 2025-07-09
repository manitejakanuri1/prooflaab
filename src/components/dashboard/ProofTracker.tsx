
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Clock, XCircle, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { format, getDaysInMonth, startOfMonth, getDay, addMonths, subMonths } from "date-fns";
import { useProofUploads } from "@/hooks/useProofUploads";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import ProofDetails from "./ProofDetails";

export default function ProofTracker() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const { data: proofUploads = [], isLoading } = useProofUploads(currentDate);
  
  const currentMonth = format(currentDate, "MMMM yyyy");
  const daysInMonth = getDaysInMonth(currentDate);
  const startDay = getDay(startOfMonth(currentDate));
  
  // Create a map of date -> proof uploads for quick lookup
  const proofsByDate = proofUploads.reduce((acc, proof) => {
    const date = new Date(proof.submitted_at).getDate();
    if (!acc[date]) acc[date] = [];
    acc[date].push(proof);
    return acc;
  }, {} as Record<number, typeof proofUploads>);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Verified': return <CheckCircle className="h-3 w-3 text-green-500" />;
      case 'Under Review': return <Clock className="h-3 w-3 text-yellow-500" />;
      case 'Rejected': return <XCircle className="h-3 w-3 text-red-500" />;
      default: return null;
    }
  };

  const getPrimaryStatus = (proofs: typeof proofUploads) => {
    if (proofs.some(p => p.status === 'Verified')) return 'Verified';
    if (proofs.some(p => p.status === 'Rejected')) return 'Rejected';
    return 'Under Review';
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => direction === 'prev' ? subMonths(prev, 1) : addMonths(prev, 1));
  };

  // Generate calendar days including empty cells for proper alignment
  const calendarDays = [];
  
  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startDay; i++) {
    calendarDays.push({ date: null, day: '', status: null, proofs: [] });
  }
  
  // Add actual days of the month
  for (let date = 1; date <= daysInMonth; date++) {
    const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][(startDay + date - 1) % 7];
    const dayProofs = proofsByDate[date] || [];
    const primaryStatus = dayProofs.length > 0 ? getPrimaryStatus(dayProofs) : null;
    
    calendarDays.push({
      date,
      day: dayOfWeek,
      status: primaryStatus,
      proofs: dayProofs
    });
  }

  if (isLoading) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <Calendar className="h-5 w-5" />
            <span>Proof Tracker</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading calendar...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
          <Calendar className="h-5 w-5" />
          <span>Proof Tracker</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Month Navigation */}
        <div className="flex items-center justify-between">
          <button 
            onClick={() => navigateMonth('prev')}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ChevronLeft className="h-4 w-4 text-gray-600" />
          </button>
          <h3 className="font-semibold text-gray-900">{currentMonth}</h3>
          <button 
            onClick={() => navigateMonth('next')}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ChevronRight className="h-4 w-4 text-gray-600" />
          </button>
        </div>

        {/* Calendar Header */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center text-xs font-medium text-gray-500 pb-2">
              {day}
            </div>
          ))}
        </div>

        {/* Full Calendar Grid */}
        <div className="grid grid-cols-7 gap-2">
          {calendarDays.map((day, index) => (
            <div key={index} className="text-center">
              {day.date ? (
                <div className="relative">
                  {day.proofs.length > 0 ? (
                    <HoverCard>
                      <HoverCardTrigger asChild>
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-medium cursor-pointer transition-colors ${
                          day.status ? 'bg-gray-100 hover:bg-gray-200' : 'bg-gray-50 hover:bg-gray-100'
                        }`}>
                          {day.date}
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent side="top" className="p-0 w-auto">
                        <div className="space-y-2">
                          {day.proofs.map((proof, idx) => (
                            <ProofDetails key={proof.id} proof={proof} />
                          ))}
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  ) : (
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-medium bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors">
                      {day.date}
                    </div>
                  )}
                  
                  {day.status && (
                    <div className="absolute -top-1 -right-1">
                      {getStatusIcon(day.status)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-8 h-8" />
              )}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex justify-center space-x-4 text-xs">
          <div className="flex items-center space-x-1">
            <CheckCircle className="h-3 w-3 text-green-500" />
            <span className="text-gray-600">Verified</span>
          </div>
          <div className="flex items-center space-x-1">
            <Clock className="h-3 w-3 text-yellow-500" />
            <span className="text-gray-600">Under Review</span>
          </div>
          <div className="flex items-center space-x-1">
            <XCircle className="h-3 w-3 text-red-500" />
            <span className="text-gray-600">Rejected</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
