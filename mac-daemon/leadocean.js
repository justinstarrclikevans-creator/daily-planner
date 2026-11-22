const DEFAULT_BASE_URL = 'https://api.leadocean.io';
const REQUEST_TIMEOUT_MS = 15000;

function getLeadOceanConfig() {
  return {
    apiKey: (process.env.LEADOCEAN_API_KEY || '').trim(),
    baseUrl: (process.env.LEADOCEAN_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
  };
}

function isLeadOceanConfigured() {
  return Boolean(getLeadOceanConfig().apiKey);
}

function pickFirstString(...candidates) {
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return '';
}

function normalizePerson(raw = {}) {
  const firstName = pickFirstString(raw.first_name, raw.firstName);
  const lastName = pickFirstString(raw.last_name, raw.lastName);
  const combinedName = `${firstName} ${lastName}`.trim();
  const org = raw.company && typeof raw.company === 'object' ? raw.company : raw.organization || {};

  const email = pickFirstString(
    raw.email,
    raw.work_email,
    raw.workEmail,
    Array.isArray(raw.emails) ? raw.emails[0]?.address || raw.emails[0] : ''
  );

  const location = pickFirstString(
    typeof raw.location === 'string' ? raw.location : '',
    [raw.city, raw.state, raw.country].filter(Boolean).join(', ')
  );

  return {
    id: pickFirstString(raw.id, raw.person_id, raw.personId),
    name: pickFirstString(raw.name, raw.full_name, raw.fullName, combinedName, 'Unknown Contact'),
    firstName,
    lastName,
    title: pickFirstString(raw.title, raw.job_title, raw.jobTitle, raw.headline),
    company: pickFirstString(
      typeof raw.company === 'string' ? raw.company : '',
      raw.company_name,
      raw.companyName,
      org?.name
    ),
    email,
    linkedinUrl: pickFirstString(raw.linkedin_url, raw.linkedinUrl, raw.linkedin),
    location,
    domain: pickFirstString(raw.domain, raw.company_domain, raw.companyDomain, org?.domain, org?.website),
  };
}

function normalizeCompany(raw = {}) {
  const location = pickFirstString(
    typeof raw.location === 'string' ? raw.location : '',
    [raw.city, raw.state, raw.country].filter(Boolean).join(', ')
  );

  return {
    id: pickFirstString(raw.id, raw.company_id, raw.companyId),
    name: pickFirstString(raw.name, raw.company_name, raw.companyName, 'Unknown Company'),
    domain: pickFirstString(raw.domain, raw.website),
    industry: pickFirstString(raw.industry, Array.isArray(raw.industries) ? raw.industries[0] : ''),
    size: pickFirstString(raw.size, raw.employee_count ? String(raw.employee_count) : ''),
    linkedinUrl: pickFirstString(raw.linkedin_url, raw.linkedinUrl),
    location,
  };
}

async function leadOceanGet(endpointPath, paramsObj = {}) {
  const { apiKey, baseUrl } = getLeadOceanConfig();
  if (!apiKey) {
    return { ok: false, status: 0, error: 'LEADOCEAN_API_KEY is not configured in mac-daemon/.env' };
  }

  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(paramsObj)) {
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      params.set(key, String(val).trim());
    }
  }

  const queryStr = params.toString();
  const url = `${baseUrl}${endpointPath}${queryStr ? `?${queryStr}` : ''}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const quota = {
      rateLimit: res.headers.get('X-RateLimit-Limit') || null,
      quotaState: res.headers.get('X-Quota-State') || null,
      quotaReset: res.headers.get('X-Quota-Reset') || null,
    };

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      let friendly = `LeadOcean API error (${res.status})`;
      if (res.status === 401) friendly = 'LeadOcean authentication failed (401): check LEADOCEAN_API_KEY.';
      else if (res.status === 403) friendly = 'LeadOcean forbidden (403): API key is missing required search/enrich scope.';
      else if (res.status === 429) friendly = 'LeadOcean rate limit or quota exceeded (429).';
      const detail = json?.error || json?.message || text?.slice(0, 200) || '';
      return {
        ok: false,
        status: res.status,
        error: detail ? `${friendly} ${detail}` : friendly,
        quota,
      };
    }

    return { ok: true, status: res.status, data: json, quota };
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err?.name === 'AbortError' ? 'LeadOcean API request timed out after 15s.' : err.message || String(err);
    return { ok: false, status: 0, error: msg };
  }
}

function extractArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.people)) return payload.people;
  if (Array.isArray(payload.companies)) return payload.companies;
  return [];
}

async function searchPeople({ q, country, title, company, limit = 8 } = {}) {
  const res = await leadOceanGet('/v1/people/search', {
    q,
    country,
    title,
    company,
    limit: Math.min(25, Math.max(1, Number(limit) || 8)),
  });
  if (!res.ok) return res;

  const rows = extractArray(res.data).map(normalizePerson);
  return {
    ok: true,
    people: rows,
    total: res.data?.meta?.total ?? rows.length,
    quota: res.quota,
  };
}

async function searchCompanies({ q, country, industry, limit = 8 } = {}) {
  const res = await leadOceanGet('/v1/companies/search', {
    q,
    country,
    industry,
    limit: Math.min(25, Math.max(1, Number(limit) || 8)),
  });
  if (!res.ok) return res;

  const rows = extractArray(res.data).map(normalizeCompany);
  return {
    ok: true,
    companies: rows,
    total: res.data?.meta?.total ?? rows.length,
    quota: res.quota,
  };
}

async function enrichPerson({ linkedin_url, email, person_id } = {}) {
  if (!linkedin_url && !email && !person_id) {
    return { ok: false, status: 400, error: 'One of linkedin_url, email, or person_id is required to enrich a person.' };
  }
  const res = await leadOceanGet('/v1/people/enrich', { linkedin_url, email, person_id });
  if (!res.ok) return res;

  const raw = res.data?.data || res.data?.person || res.data;
  return {
    ok: true,
    person: normalizePerson(raw),
    quota: res.quota,
  };
}

module.exports = {
  isLeadOceanConfigured,
  searchPeople,
  searchCompanies,
  enrichPerson,
};
