"use client";

import * as React from "react";
import { useActionState } from "react";
import { completeProfile } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export default function CompleteProfilePage() {
  const [state, action, pending] = useActionState(completeProfile, {});

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Welcome to Octopus</CardTitle>
          <CardDescription>
            What should we call you?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form id="profile-form" action={action}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Your name</FieldLabel>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="e.g. John"
                  required
                  minLength={2}
                  maxLength={100}
                  autoFocus
                />
              </Field>
              {state.error && <FieldError>{state.error}</FieldError>}
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter>
          <Button
            type="submit"
            form="profile-form"
            className="w-full"
            disabled={pending}
          >
            {pending ? "Setting up..." : "Continue"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
