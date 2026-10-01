export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center">
        <div className="text-5xl mb-4">🚫</div>
        <h1 className="text-xl font-bold mb-2">ခွင့်ပြုချက် မရှိပါ / Access denied</h1>
        <p className="text-muted-foreground text-sm mb-4">
          Your role cannot access this page. / သင့်အခန်းကဏ္ဍဖြင့် ဝင်ရောက်၍ မရပါ။
        </p>
        <a href="/dashboard" className="text-primary underline">
          ← Dashboard
        </a>
      </div>
    </div>
  );
}
