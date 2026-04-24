"use client";

import type { ReactNode } from "react";
import { Component } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
  description: string;
  title: string;
};

type State = {
  hasError: boolean;
};

export class VibeErrorBoundary extends Component<Props, State> {
  override state: State = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return {
      hasError: true,
    };
  }

  override componentDidCatch(error: unknown) {
    console.error(error);
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-4 px-6 text-center">
          <div>
            <div className="text-sm font-semibold text-slate-900">
              {this.props.title}
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {this.props.description}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full border-slate-200 bg-white"
            onClick={this.handleRetry}
          >
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
