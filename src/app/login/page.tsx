'use client'

import { useState } from 'react'
import { login, signup, loginWithGoogle } from './actions'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconBrandGoogleFilled } from '@tabler/icons-react'
import { toast } from 'sonner'
import { useFormStatus } from 'react-dom'

function SubmitButton({ isLogin }: { isLogin: boolean }) {
    const { pending } = useFormStatus()
    return (
        <Button className="w-full bg-[#FF8903] hover:bg-[#FEB107] text-white font-semibold" type="submit" disabled={pending}>
            {pending ? "Loading..." : (isLogin ? "Sign In" : "Sign Up")}
        </Button>
    )
}

export default function LoginPage() {
    const [isLogin, setIsLogin] = useState(true)

    async function clientAction(formData: FormData) {
        const action = isLogin ? login : signup
        const result = await action(formData)
        if (result && !result.success) {
            toast.error(result.message)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="text-2xl text-center">
                        ASO Keyword Optimization
                    </CardTitle>
                    <CardDescription className="text-center">
                        {isLogin ? "Welcome back" : "Create an account to get started"}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4">
                        <Button variant="outline" className="w-full" onClick={() => loginWithGoogle()}>
                            <IconBrandGoogleFilled className="mr-2 h-4 w-4 text-red-500" />
                            Continue with Google
                        </Button>
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-white px-2 text-muted-foreground">
                                    Or continue with email
                                </span>
                            </div>
                        </div>
                        <form action={clientAction} className="grid gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="email">Email</Label>
                                <Input id="email" name="email" type="email" placeholder="m@example.com" required />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="password">Password</Label>
                                <Input id="password" name="password" type="password" required minLength={6} />
                            </div>
                            <SubmitButton isLogin={isLogin} />
                        </form>
                    </div>
                </CardContent>
                <CardFooter className="flex flex-col space-y-2">
                    <div className="text-sm text-center text-muted-foreground mt-4">
                        {isLogin ? "Don't have an account? " : "Already have an account? "}
                        <button
                            onClick={() => setIsLogin(!isLogin)}
                            className="text-[#FF8903] hover:underline font-medium"
                        >
                            {isLogin ? "Sign up" : "Sign in"}
                        </button>
                    </div>
                </CardFooter>
            </Card>
        </div>
    )
}
