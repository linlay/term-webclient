import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useLogin } from "./useAuth";

const schema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required")
});

type LoginFormValues = z.infer<typeof schema>;

export function LoginForm(): JSX.Element {
  const [error, setError] = useState("");
  const login = useLogin();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: "",
      password: ""
    }
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError("");
    try {
      await login.mutateAsync(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    }
  });

  return (
    <div className="react-login-screen">
      <form className="react-login-card" onSubmit={onSubmit}>
        <h1>Sign In</h1>

        <label htmlFor="react-login-username">Username</label>
        <input
          id="react-login-username"
          type="text"
          autoComplete="username"
          {...form.register("username")}
        />
        {form.formState.errors.username && (
          <div className="react-form-error">{form.formState.errors.username.message}</div>
        )}

        <label htmlFor="react-login-password">Password</label>
        <input
          id="react-login-password"
          type="password"
          autoComplete="current-password"
          {...form.register("password")}
        />
        {form.formState.errors.password && (
          <div className="react-form-error">{form.formState.errors.password.message}</div>
        )}

        {error && <div className="react-form-error react-form-error-block">{error}</div>}

        <button type="submit" disabled={login.isPending}>
          {login.isPending ? "Signing In..." : "Login"}
        </button>
      </form>
    </div>
  );
}
