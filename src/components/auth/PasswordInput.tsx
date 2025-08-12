import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  showStrengthMeter?: boolean;
}

export type PasswordStrength = 'weak' | 'medium' | 'strong';

export const validatePassword = (password: string): PasswordStrength => {
  const hasLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  const score = [hasLength, hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
  
  if (score < 3) return 'weak';
  if (score < 5) return 'medium';
  return 'strong';
};

export const isPasswordValid = (password: string): boolean => {
  return validatePassword(password) !== 'weak';
};

export default function PasswordInput({ 
  value, 
  onChange, 
  placeholder = "Password", 
  required = false,
  showStrengthMeter = false
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  
  const strength = validatePassword(value);
  
  const getStrengthColor = (strength: PasswordStrength) => {
    switch (strength) {
      case 'weak': return 'bg-destructive';
      case 'medium': return 'bg-yellow-500';
      case 'strong': return 'bg-green-500';
    }
  };
  
  const getStrengthText = (strength: PasswordStrength) => {
    switch (strength) {
      case 'weak': return 'Weak';
      case 'medium': return 'Medium';
      case 'strong': return 'Strong';
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          type={showPassword ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="pr-10"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
          onClick={() => setShowPassword(!showPassword)}
        >
          {showPassword ? (
            <EyeOff className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Eye className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </div>
      
      {showStrengthMeter && value && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Password strength:</span>
            <span className={cn(
              "font-medium",
              strength === 'weak' && "text-destructive",
              strength === 'medium' && "text-yellow-600",
              strength === 'strong' && "text-green-600"
            )}>
              {getStrengthText(strength)}
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className={cn(
                "h-full transition-all duration-300",
                getStrengthColor(strength)
              )}
              style={{ 
                width: strength === 'weak' ? '33%' : strength === 'medium' ? '66%' : '100%' 
              }}
            />
          </div>
          {strength === 'weak' && (
            <p className="text-xs text-destructive">
              Password must be at least 8 characters with uppercase, lowercase, number, and special character
            </p>
          )}
        </div>
      )}
    </div>
  );
}