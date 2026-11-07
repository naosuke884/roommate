// wrangler types は secrets.required にある secret しか型にしないので、任意の secret はここに書く
declare namespace Cloudflare {
  interface Env {
    /** 鍵を替えたあと、前の鍵で署名したトークンも確かめるための前の鍵。替えていなければ無い */
    JWT_SECRET_PREVIOUS?: string;
  }
}
