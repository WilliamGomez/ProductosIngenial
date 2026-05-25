import azure.functions as func

from app.functions.http_functions.user_functions import users_bp
from app.functions.http_functions.department_functions import department_bp
from app.functions.http_functions.municipality_functions import municipality_bp
from app.functions.http_functions.countries_functions import countries_bp
from app.functions.http_functions.sessions_functions import sessions_bp
from app.functions.http_functions.power_bi_functions import power_bi_bp
from app.functions.http_functions.admin_functions import admin_bp
from app.functions.http_functions.divipola_functions import divipola_bp
from app.functions.http_functions.health_functions import health_bp
from app.functions.http_functions.mfa_functions import mfa_bp


app = func.FunctionApp()

app.register_functions(users_bp)
app.register_functions(countries_bp)
app.register_functions(sessions_bp)
app.register_functions(department_bp)
app.register_functions(municipality_bp)
app.register_functions(power_bi_bp)
app.register_functions(admin_bp)
app.register_functions(divipola_bp)
app.register_functions(health_bp)
app.register_functions(mfa_bp)
